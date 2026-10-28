/**
 * @file Output schemas for the typed MCP tools.
 *
 * Each schema describes the bounded JSON payload the matching `--json` CLI
 * command emits, which the tool also returns as `structuredContent`.
 */
import { Schema } from "effect";

const TruncationNotice = Schema.Struct({
  path: Schema.String,
  unit: Schema.Literals(["characters", "items"]),
  original: Schema.Finite,
  retained: Schema.Finite,
});

const RemoteDetail = Schema.Struct({
  name: Schema.String,
  fetchUrl: Schema.String,
  pushUrl: Schema.String,
});

const BranchMetadata = Schema.Struct({
  repositoryRoot: Schema.String,
  repositoryName: Schema.String,
  currentBranch: Schema.String,
  headSha: Schema.String,
  defaultRemote: Schema.NullOr(Schema.String),
  defaultBranch: Schema.NullOr(Schema.String),
  baseRef: Schema.NullOr(Schema.String),
  upstreamRef: Schema.String,
  ahead: Schema.NullOr(Schema.Finite),
  behind: Schema.NullOr(Schema.Finite),
  onDefaultBranch: Schema.NullOr(Schema.Boolean),
  remotes: Schema.Array(Schema.String),
  remoteDetails: Schema.optional(Schema.Array(RemoteDetail)),
});

const PullRequestSummary = Schema.Struct({
  number: Schema.Finite,
  state: Schema.String,
  title: Schema.String,
  commentCount: Schema.Finite,
  reviewDecision: Schema.String,
  url: Schema.String,
  isDraft: Schema.Boolean,
  mergeStateStatus: Schema.String,
  headRefName: Schema.String,
  baseRefName: Schema.String,
});

const PullRequest = Schema.Struct({
  summary: PullRequestSummary,
  description: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(Schema.String)),
  comments: Schema.optional(
    Schema.Array(
      Schema.Struct({
        author: Schema.String,
        createdAt: Schema.String,
        body: Schema.String,
      }),
    ),
  ),
  reviews: Schema.optional(
    Schema.Array(
      Schema.Struct({
        author: Schema.String,
        state: Schema.String,
        submittedAt: Schema.String,
        body: Schema.String,
      }),
    ),
  ),
  checks: Schema.optional(Schema.String),
  truncations: Schema.Array(TruncationNotice),
});

const WorkScope = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("collected"),
    baseRef: Schema.String,
    branchCommits: Schema.String,
    branchFiles: Schema.String,
    branchDiffStat: Schema.String,
  }),
  Schema.Struct({
    state: Schema.Literals(["not-applicable", "unresolved"]),
    reason: Schema.String,
  }),
]);

/** `git_context` result: the `context git --json` payload. Diffs stay text-only. */
export const GitContextResult = Schema.Struct({
  inRepo: Schema.Boolean,
  branchMetadata: Schema.optional(BranchMetadata),
  status: Schema.optional(
    Schema.Struct({
      short: Schema.String,
      unstaged: Schema.String,
      staged: Schema.String,
      untracked: Schema.String,
    }),
  ),
  workScope: Schema.optional(WorkScope),
  commits: Schema.optional(Schema.String),
  pullRequest: Schema.NullOr(PullRequest),
  warnings: Schema.Array(Schema.String),
  truncations: Schema.Array(TruncationNotice),
});

const StackConfidence = Schema.Literals([
  "authoritative",
  "strong",
  "heuristic",
]);

const StackTruncation = Schema.Struct({
  reason: Schema.Literals([
    "ecosystemManifestOutput",
    "ecosystemsOutput",
    "frameworksOutput",
    "gitFileListBytes",
    "jsonOutputBytes",
    "languageLocations",
    "languageLocationsOutput",
    "languagesOutput",
    "manifestCollection",
    "manifestReadBytes",
    "manifestTotalReadBytes",
    "maxDepth",
    "maxFiles",
    "textOutputBytes",
    "outputValueBytes",
    "toolingEvidenceCollection",
    "toolingEvidenceOutput",
    "toolingOutput",
    "truncationReasons",
    "truncationReasonsOutput",
    "warnings",
  ]),
  limit: Schema.Finite,
  observed: Schema.optional(Schema.Finite),
  omitted: Schema.optional(Schema.Finite),
  subject: Schema.optional(Schema.String),
});

/** `stack_context` result: the `context stack --json` payload. */
export const StackContextResult = Schema.Struct({
  root: Schema.String,
  name: Schema.String,
  scannedFiles: Schema.Finite,
  truncations: Schema.Array(StackTruncation),
  languages: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      files: Schema.Finite,
      locations: Schema.Array(Schema.String),
      confidence: StackConfidence,
    }),
  ),
  ecosystems: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      manifests: Schema.Array(Schema.String),
      confidence: StackConfidence,
    }),
  ),
  tooling: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      kinds: Schema.Array(
        Schema.Literals([
          "package manager",
          "linter",
          "formatter",
          "task runner",
          "build tool",
          "test runner",
          "git hook",
          "release tool",
        ]),
      ),
      evidence: Schema.Array(Schema.String),
      confidence: StackConfidence,
    }),
  ),
  frameworks: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      via: Schema.String,
      confidence: StackConfidence,
    }),
  ),
  warnings: Schema.Array(Schema.String),
});
