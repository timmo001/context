/**
 * @file JSON renderer for `context git --json`.
 *
 * Serialises a {@link BranchContextData} snapshot into the structured payload
 * the OpenCode branch-context plugin consumes. Section text blocks are
 * pre-truncated here (via {@link CHAR_LIMITS}) so prompt-size bounding lives in
 * one place and the plugin stays a thin XML renderer.
 */
import { CHAR_LIMITS, METADATA_LIMITS } from "./model.js";
import { escapeTextControls } from "../../lib/text.js";
import type {
  BranchContextData,
  BranchMetadata,
  CommitRecord,
  FileChange,
  PullRequestData,
  TruncationNotice,
} from "./model.js";

/** Truncate text to a character budget, appending a notice when it overflows. */
function limited(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[TRUNCATED ${text.length - max} CHARS]`;
}

function limitedWithNotice(
  text: string,
  max: number,
  path: string,
  truncations: TruncationNotice[],
): string {
  if (text.length <= max) return text;
  truncations.push({
    path,
    unit: "characters",
    original: text.length,
    retained: max,
  });
  return limited(text, max);
}

/** Join `--name-status` raw lines. */
function nameStatusText(files: readonly FileChange[]): string {
  return files.map((file) => file.raw).join("\n");
}

function safeMultiline(value: string): string {
  return escapeTextControls(value.replace(/\r\n?/g, "\n"), true);
}

function safeBranchMetadata(
  metadata: BranchMetadata,
  truncations: TruncationNotice[],
): BranchMetadata {
  const metadataValue = (value: string, path: string) =>
    limitedWithNotice(
      escapeTextControls(value),
      CHAR_LIMITS.metadata,
      path,
      truncations,
    );
  const remoteValue = (value: string, path: string) =>
    limitedWithNotice(
      escapeTextControls(value),
      CHAR_LIMITS.remote,
      path,
      truncations,
    );
  if (metadata.remotes.length > METADATA_LIMITS.remotes) {
    truncations.push({
      path: "branchMetadata.remotes",
      unit: "items",
      original: metadata.remotes.length,
      retained: METADATA_LIMITS.remotes,
    });
  }
  if (
    metadata.remoteDetails &&
    metadata.remoteDetails.length > METADATA_LIMITS.remoteDetails
  ) {
    truncations.push({
      path: "branchMetadata.remoteDetails",
      unit: "items",
      original: metadata.remoteDetails.length,
      retained: METADATA_LIMITS.remoteDetails,
    });
  }
  return {
    ...metadata,
    repositoryRoot: metadataValue(
      metadata.repositoryRoot,
      "branchMetadata.repositoryRoot",
    ),
    repositoryName: metadataValue(
      metadata.repositoryName,
      "branchMetadata.repositoryName",
    ),
    currentBranch: metadataValue(
      metadata.currentBranch,
      "branchMetadata.currentBranch",
    ),
    headSha: metadataValue(metadata.headSha, "branchMetadata.headSha"),
    defaultRemote:
      metadata.defaultRemote === null
        ? null
        : remoteValue(metadata.defaultRemote, "branchMetadata.defaultRemote"),
    defaultBranch:
      metadata.defaultBranch === null
        ? null
        : metadataValue(metadata.defaultBranch, "branchMetadata.defaultBranch"),
    baseRef:
      metadata.baseRef === null
        ? null
        : metadataValue(metadata.baseRef, "branchMetadata.baseRef"),
    upstreamRef: metadataValue(
      metadata.upstreamRef,
      "branchMetadata.upstreamRef",
    ),
    remotes: metadata.remotes
      .slice(0, METADATA_LIMITS.remotes)
      .map((remote, index) =>
        remoteValue(remote, `branchMetadata.remotes[${index}]`),
      ),
    ...(metadata.remoteDetails
      ? {
          remoteDetails: metadata.remoteDetails
            .slice(0, METADATA_LIMITS.remoteDetails)
            .map((remote, index) => ({
              name: remoteValue(
                remote.name,
                `branchMetadata.remoteDetails[${index}].name`,
              ),
              fetchUrl: limitedWithNotice(
                escapeTextControls(remote.fetchUrl),
                CHAR_LIMITS.remoteUrl,
                `branchMetadata.remoteDetails[${index}].fetchUrl`,
                truncations,
              ),
              pushUrl: limitedWithNotice(
                escapeTextControls(remote.pushUrl),
                CHAR_LIMITS.remoteUrl,
                `branchMetadata.remoteDetails[${index}].pushUrl`,
                truncations,
              ),
            })),
        }
      : {}),
  };
}

/**
 * Render recent commits as compact lines (`<marker> <hash> <time> <subject>`).
 * Emitted only for the default-branch payload, where branch-scope commits are
 * empty; the pushed (`✓`) / local (`↑`) marker mirrors the text legend.
 */
function recentCommitsText(records: readonly CommitRecord[]): string {
  return records
    .map((commit) =>
      `${commit.pushed ? "✓" : "↑"} ${escapeTextControls(commit.shortHash)} ${commit.relativeTime} ${escapeTextControls(commit.subject)}`.trimEnd(),
    )
    .join("\n");
}

/** Serialised pull request block for the JSON payload. */
interface PullRequestJson {
  readonly summary: PullRequestData["summary"];
  readonly description?: string;
  readonly labels?: readonly string[];
  readonly comments?: PullRequestData["comments"];
  readonly reviews?: PullRequestData["reviews"];
  readonly checks?: string;
  readonly truncations: PullRequestData["truncations"];
}

/** Serialise the bounded pull request block and escape control characters. */
function toPullRequestJson(pr: PullRequestData): PullRequestJson {
  return {
    summary: {
      ...pr.summary,
      state: escapeTextControls(pr.summary.state),
      title: escapeTextControls(pr.summary.title),
      reviewDecision: escapeTextControls(pr.summary.reviewDecision),
      url: escapeTextControls(pr.summary.url),
      mergeStateStatus: escapeTextControls(pr.summary.mergeStateStatus),
      headRefName: escapeTextControls(pr.summary.headRefName),
      baseRefName: escapeTextControls(pr.summary.baseRefName),
    },
    ...(pr.description !== undefined
      ? { description: safeMultiline(pr.description) }
      : {}),
    ...(pr.labels !== undefined
      ? { labels: pr.labels.map((label) => escapeTextControls(label)) }
      : {}),
    ...(pr.comments !== undefined
      ? {
          comments: pr.comments.map((comment) => ({
            author: escapeTextControls(comment.author),
            createdAt: escapeTextControls(comment.createdAt),
            body: safeMultiline(comment.body),
          })),
        }
      : {}),
    ...(pr.reviews !== undefined
      ? {
          reviews: pr.reviews.map((review) => ({
            author: escapeTextControls(review.author),
            state: escapeTextControls(review.state),
            submittedAt: escapeTextControls(review.submittedAt),
            body: safeMultiline(review.body),
          })),
        }
      : {}),
    ...(pr.checks !== undefined
      ? { checks: limited(safeMultiline(pr.checks), CHAR_LIMITS.checks) }
      : {}),
    truncations: pr.truncations,
  };
}

function limitedWarnings(
  warnings: readonly string[],
  truncations: TruncationNotice[],
): readonly string[] {
  const bounded: string[] = [];
  let remaining = CHAR_LIMITS.warnings;
  for (const warning of warnings) {
    if (remaining <= 0) break;
    const value = limitedWithNotice(
      escapeTextControls(warning),
      Math.min(remaining, CHAR_LIMITS.warning),
      `warnings[${bounded.length}]`,
      truncations,
    );
    bounded.push(value);
    remaining -= value.length;
  }
  if (bounded.length < warnings.length) {
    truncations.push({
      path: "warnings",
      unit: "items",
      original: warnings.length,
      retained: bounded.length,
    });
    bounded.push(`[TRUNCATED ${warnings.length - bounded.length} WARNINGS]`);
  }
  return bounded;
}

/**
 * Render the branch-context snapshot as the JSON payload consumed by the
 * plugin. Only enabled sections are present; `pullRequest` is `null` when none
 * applies, and `inRepo: false` signals the plugin to emit its error block. The
 * recent-commit list is serialised as `commits` when branch scope was not
 * collected, including when the default branch is unresolved.
 */
export function renderBranchContextJson(data: BranchContextData): string {
  const truncations: TruncationNotice[] = [];
  if (!data.inRepo) {
    return JSON.stringify({
      inRepo: false,
      pullRequest: null,
      warnings: limitedWarnings(data.warnings, truncations),
      truncations,
    });
  }

  const workScopeCollected = data.workScope?.state === "collected";
  const recentCommits =
    !workScopeCollected && data.commits && data.commits.records.length > 0
      ? recentCommitsText(data.commits.records)
      : undefined;
  const branchMetadata = data.branchMetadata
    ? safeBranchMetadata(data.branchMetadata, truncations)
    : undefined;

  const payload = {
    inRepo: true,
    ...(branchMetadata ? { branchMetadata } : {}),
    ...(data.status
      ? {
          status: {
            short: limitedWithNotice(
              data.status.short,
              CHAR_LIMITS.status,
              "status.short",
              truncations,
            ),
            unstaged: limitedWithNotice(
              nameStatusText(data.status.unstaged),
              CHAR_LIMITS.nameStatus,
              "status.unstaged",
              truncations,
            ),
            staged: limitedWithNotice(
              nameStatusText(data.status.staged),
              CHAR_LIMITS.nameStatus,
              "status.staged",
              truncations,
            ),
            untracked: limitedWithNotice(
              nameStatusText(data.status.untracked),
              CHAR_LIMITS.nameStatus,
              "status.untracked",
              truncations,
            ),
          },
        }
      : {}),
    ...(data.workScope?.state === "collected"
      ? {
          workScope: {
            state: data.workScope.state,
            baseRef: escapeTextControls(data.workScope.baseRef),
            branchCommits: limitedWithNotice(
              data.workScope.branchCommits
                .map((commit) =>
                  `${escapeTextControls(commit.hash)} ${escapeTextControls(commit.subject)}`.trimEnd(),
                )
                .join("\n"),
              CHAR_LIMITS.commits,
              "workScope.branchCommits",
              truncations,
            ),
            branchFiles: limitedWithNotice(
              nameStatusText(data.workScope.branchFiles),
              CHAR_LIMITS.nameStatus,
              "workScope.branchFiles",
              truncations,
            ),
            branchDiffStat: limitedWithNotice(
              safeMultiline(data.workScope.branchDiffStat),
              CHAR_LIMITS.diffStat,
              "workScope.branchDiffStat",
              truncations,
            ),
          },
        }
      : data.workScope
        ? {
            workScope: {
              ...data.workScope,
              reason: escapeTextControls(data.workScope.reason),
            },
          }
        : {}),
    ...(recentCommits !== undefined
      ? {
          commits: limitedWithNotice(
            recentCommits,
            CHAR_LIMITS.commits,
            "commits",
            truncations,
          ),
        }
      : {}),
    pullRequest: data.pullRequest ? toPullRequestJson(data.pullRequest) : null,
    warnings: limitedWarnings(data.warnings, truncations),
    truncations,
  };

  const rendered = JSON.stringify(payload);
  if (rendered.length <= CHAR_LIMITS.jsonOutput) return rendered;

  const warning = `Branch context payload exceeded ${CHAR_LIMITS.jsonOutput} characters; large sections were omitted.`;
  return JSON.stringify({
    inRepo: true,
    ...(branchMetadata ? { branchMetadata } : {}),
    pullRequest: null,
    warnings: limitedWarnings([...data.warnings, warning], truncations),
    truncations: [
      ...truncations,
      {
        path: "payload",
        unit: "characters",
        original: rendered.length,
        retained: CHAR_LIMITS.jsonOutput,
      },
    ],
  });
}
