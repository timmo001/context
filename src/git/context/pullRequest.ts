/**
 * @file Pull request collection for the branch-context producer.
 *
 * Fetches the pull request associated with the current branch via `gh pr view`
 * (one call covering summary, description, comments, reviews, review decision,
 * and labels) plus an optional `gh pr checks` call. Every failure (missing gh,
 * no PR for the branch, network error) resolves to `null` with a warning so the
 * branch-context snapshot never fails on the pull request lookup.
 */
import { Effect, Option, Schema } from "effect";
import { GitHub } from "../services/GitHub.js";
import type {
  BranchContextOptions,
  PullRequestComment,
  PullRequestData,
  PullRequestReview,
  PullRequestSummary,
  TruncationNotice,
} from "./model.js";
import { CHAR_LIMITS, PR_LIMITS } from "./model.js";

/** Result of a pull request collection attempt: data and any warnings. */
export interface PullRequestResult {
  /** Collected pull request data, or `null` when none applies. */
  readonly data: PullRequestData | null;
  /** Non-fatal warnings raised during collection. */
  readonly warnings: readonly string[];
}

const GitHubObject = Schema.Record(Schema.String, Schema.Json);

const stringWithFallback = Schema.String.pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some(""))),
  Schema.withDecodingDefaultKey(Effect.succeed("")),
);
const booleanWithFallback = Schema.Boolean.pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some(false))),
  Schema.withDecodingDefaultKey(Effect.succeed(false)),
);
const jsonArrayWithFallback = Schema.Array(Schema.Json).pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some([]))),
  Schema.withDecodingDefaultKey(Effect.succeed([])),
);

const GitHubPullRequest = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  state: stringWithFallback,
  url: stringWithFallback,
  isDraft: booleanWithFallback,
  mergeStateStatus: stringWithFallback,
  headRefName: stringWithFallback,
  baseRefName: stringWithFallback,
  reviewDecision: stringWithFallback,
  body: stringWithFallback,
  comments: jsonArrayWithFallback,
  reviews: jsonArrayWithFallback,
  labels: jsonArrayWithFallback,
});

const GitHubAuthor = Schema.Struct({ login: stringWithFallback });
const authorWithFallback = GitHubAuthor.pipe(
  Schema.catchDecoding(() => Effect.succeed(Option.some({ login: "" }))),
  Schema.withDecodingDefaultKey(Effect.succeed({ login: "" })),
);
const GitHubComment = Schema.Struct({
  author: authorWithFallback,
  createdAt: stringWithFallback,
  body: stringWithFallback,
});
const GitHubReview = Schema.Struct({
  author: authorWithFallback,
  state: stringWithFallback,
  submittedAt: stringWithFallback,
  body: stringWithFallback,
});
const GitHubLabel = Schema.Struct({ name: stringWithFallback });

type GitHubPullRequestInput = typeof GitHubPullRequest.Type;

interface TextBudget {
  remaining: number;
}

function warningDetail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= CHAR_LIMITS.warning) return trimmed;
  return `${trimmed.slice(0, CHAR_LIMITS.warning)} [TRUNCATED ${trimmed.length - CHAR_LIMITS.warning} CHARS]`;
}

function githubFailureDetail(stderr: string, command: string): string {
  return warningDetail(stderr.trim() || command);
}

/** Bound a string field. */
function boundedText(
  value: string,
  path: string,
  max: number,
  truncations: TruncationNotice[],
  budget?: TextBudget,
): string {
  const retained = Math.min(max, budget?.remaining ?? max, value.length);
  if (budget) budget.remaining -= retained;
  if (retained < value.length) {
    truncations.push({
      path,
      unit: "characters",
      original: value.length,
      retained,
    });
  }
  return value.slice(0, retained);
}

/** Read a `gh` author object's login, defaulting to `(unknown)`. */
function authorLogin(
  author: typeof GitHubAuthor.Type,
  path: string,
  truncations: TruncationNotice[],
  budget?: TextBudget,
): string {
  const login = boundedText(
    author.login,
    path,
    PR_LIMITS.scalar,
    truncations,
    budget,
  );
  return login || "(unknown)";
}

/** Parse the always-on summary fields from a `gh pr view` record. */
function parseSummary(
  record: GitHubPullRequestInput,
  truncations: TruncationNotice[],
): PullRequestSummary | null {
  const number = record.number;
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  const commentCount = record.comments.length;
  return {
    number,
    state: boundedText(
      record.state,
      "summary.state",
      PR_LIMITS.scalar,
      truncations,
    ),
    title: boundedText(
      record.title,
      "summary.title",
      PR_LIMITS.title,
      truncations,
    ),
    commentCount: Number.isSafeInteger(commentCount)
      ? Math.min(commentCount, Number.MAX_SAFE_INTEGER)
      : 0,
    reviewDecision: boundedText(
      record.reviewDecision,
      "summary.reviewDecision",
      PR_LIMITS.scalar,
      truncations,
    ),
    url: boundedText(record.url, "summary.url", PR_LIMITS.url, truncations),
    isDraft: record.isDraft,
    mergeStateStatus: boundedText(
      record.mergeStateStatus,
      "summary.mergeStateStatus",
      PR_LIMITS.scalar,
      truncations,
    ),
    headRefName: boundedText(
      record.headRefName,
      "summary.headRefName",
      PR_LIMITS.scalar,
      truncations,
    ),
    baseRefName: boundedText(
      record.baseRefName,
      "summary.baseRefName",
      PR_LIMITS.scalar,
      truncations,
    ),
  };
}

/** Parse conversation comments from a `gh pr view` record. */
function parseComments(
  value: readonly Schema.Json[],
  truncations: TruncationNotice[],
): readonly PullRequestComment[] {
  const records = value.flatMap((item) =>
    Option.match(Schema.decodeUnknownOption(GitHubComment)(item), {
      onNone: () => [],
      onSome: (comment) => [comment],
    }),
  );
  const retained = records.slice(0, PR_LIMITS.comments);
  if (retained.length < records.length) {
    truncations.push({
      path: "comments",
      unit: "items",
      original: records.length,
      retained: retained.length,
    });
  }
  const budget = { remaining: PR_LIMITS.collectionText };
  return retained.map((comment, index) => ({
    author: authorLogin(
      comment.author,
      `comments[${index}].author`,
      truncations,
      budget,
    ),
    createdAt: boundedText(
      comment.createdAt,
      `comments[${index}].createdAt`,
      PR_LIMITS.scalar,
      truncations,
      budget,
    ),
    body: boundedText(
      comment.body,
      `comments[${index}].body`,
      PR_LIMITS.itemBody,
      truncations,
      budget,
    ),
  }));
}

/** Parse review submissions from a `gh pr view` record. */
function parseReviews(
  value: readonly Schema.Json[],
  truncations: TruncationNotice[],
): readonly PullRequestReview[] {
  const records = value.flatMap((item) =>
    Option.match(Schema.decodeUnknownOption(GitHubReview)(item), {
      onNone: () => [],
      onSome: (review) => [review],
    }),
  );
  const retained = records.slice(0, PR_LIMITS.reviews);
  if (retained.length < records.length) {
    truncations.push({
      path: "reviews",
      unit: "items",
      original: records.length,
      retained: retained.length,
    });
  }
  const budget = { remaining: PR_LIMITS.collectionText };
  return retained.map((review, index) => ({
    author: authorLogin(
      review.author,
      `reviews[${index}].author`,
      truncations,
      budget,
    ),
    state: boundedText(
      review.state,
      `reviews[${index}].state`,
      PR_LIMITS.scalar,
      truncations,
      budget,
    ),
    submittedAt: boundedText(
      review.submittedAt,
      `reviews[${index}].submittedAt`,
      PR_LIMITS.scalar,
      truncations,
      budget,
    ),
    body: boundedText(
      review.body,
      `reviews[${index}].body`,
      PR_LIMITS.itemBody,
      truncations,
      budget,
    ),
  }));
}

/** Parse label names from a `gh pr view` record. */
function parseLabels(
  value: readonly Schema.Json[],
  truncations: TruncationNotice[],
): readonly string[] {
  const records = value.flatMap((item) =>
    Option.match(Schema.decodeUnknownOption(GitHubLabel)(item), {
      onNone: () => [],
      onSome: (label) => [label],
    }),
  );
  const retained = records.slice(0, PR_LIMITS.labels);
  if (retained.length < records.length) {
    truncations.push({
      path: "labels",
      unit: "items",
      original: records.length,
      retained: retained.length,
    });
  }
  const budget = { remaining: PR_LIMITS.collectionText };
  return retained
    .map((label, index) =>
      boundedText(
        label.name,
        `labels[${index}]`,
        PR_LIMITS.scalar,
        truncations,
        budget,
      ),
    )
    .filter(Boolean);
}

/** Build the `--json` field list for `gh pr view` based on enabled sections. */
function prViewFields(options: BranchContextOptions): string {
  const fields = [
    "number",
    "state",
    "title",
    "url",
    "isDraft",
    "mergeStateStatus",
    "headRefName",
    "baseRefName",
    "reviewDecision",
    "body",
    "comments",
  ];
  if (options.labels) fields.push("labels");
  if (options.reviews) fields.push("reviews");
  return fields.join(",");
}

/**
 * Collect the pull request for the current branch. Skips entirely (returns
 * `null`, no warning) when the pull request section is disabled. Resolves to
 * `null` with no warning when there is simply no PR for the branch, and to
 * `null` with a warning on an unexpected failure.
 */
export function collectPullRequest(
  options: BranchContextOptions,
): Effect.Effect<PullRequestResult, never, GitHub> {
  return Effect.gen(function* () {
    if (!options.pullRequest) return { data: null, warnings: [] };

    const github = yield* GitHub;
    const viewResult = yield* github
      .json(["pr", "view", "--json", prViewFields(options)], {
        checkRateLimit: false,
        retries: 0,
      })
      .pipe(
        Effect.matchEffect({
          onSuccess: (value) => Effect.succeed({ ok: true as const, value }),
          onFailure: (error) => Effect.succeed({ ok: false as const, error }),
        }),
      );

    if (!viewResult.ok) {
      // A missing PR is the common, expected case and not worth a warning.
      const stderr = viewResult.error.stderr.toLowerCase();
      if (stderr.includes("no pull requests found")) {
        return { data: null, warnings: [] };
      }
      return {
        data: null,
        warnings: [
          `Unable to read PR details: ${githubFailureDetail(viewResult.error.stderr, viewResult.error.command)}`,
        ],
      };
    }

    if (
      Option.isNone(Schema.decodeUnknownOption(GitHubObject)(viewResult.value))
    ) {
      return {
        data: null,
        warnings: ["Unable to read PR details: unexpected response."],
      };
    }
    const decoded = Schema.decodeUnknownOption(GitHubPullRequest)(
      viewResult.value,
    );
    if (Option.isNone(decoded)) {
      return {
        data: null,
        warnings: ["Unable to read PR details: required fields are missing."],
      };
    }
    const truncations: TruncationNotice[] = [];
    const record = decoded.value;
    const summary = parseSummary(record, truncations);
    if (!summary) {
      return {
        data: null,
        warnings: ["Unable to read PR details: required fields are missing."],
      };
    }

    const warnings: string[] = [];

    let checks: string | undefined;
    if (options.checks) {
      const checksResult = yield* github
        .run(["pr", "checks", String(summary.number)], {
          checkRateLimit: false,
          retries: 0,
        })
        .pipe(
          Effect.matchEffect({
            onSuccess: (value) => Effect.succeed({ ok: true as const, value }),
            onFailure: (error) => Effect.succeed({ ok: false as const, error }),
          }),
        );
      // `gh pr checks` exits non-zero when checks are pending or failing, so its
      // stdout is still useful; keep it and only warn when there is no output.
      if (checksResult.ok) {
        checks = checksResult.value.trim();
      } else {
        checks =
          checksResult.error.stdout.trim() || checksResult.error.stderr.trim();
        if (!checks) warnings.push("Unable to read PR checks.");
      }
      if (checks && checks.length > PR_LIMITS.checks) {
        truncations.push({
          path: "checks",
          unit: "characters",
          original: checks.length,
          retained: PR_LIMITS.checks,
        });
        checks = checks.slice(0, PR_LIMITS.checks);
      }
    }

    let data: PullRequestData = {
      summary,
      truncations,
    };
    if (options.description) {
      data = {
        ...data,
        description: boundedText(
          record.body,
          "description",
          PR_LIMITS.body,
          truncations,
        ),
      };
    }
    if (options.labels) {
      data = { ...data, labels: parseLabels(record.labels, truncations) };
    }
    if (options.comments) {
      data = { ...data, comments: parseComments(record.comments, truncations) };
    }
    if (options.reviews) {
      data = { ...data, reviews: parseReviews(record.reviews, truncations) };
    }
    if (checks !== undefined) data = { ...data, checks };
    for (const truncation of truncations) {
      warnings.push(
        `Truncated PR ${truncation.path} from ${truncation.original} to ${truncation.retained} ${truncation.unit}.`,
      );
    }
    return { data, warnings };
  });
}
