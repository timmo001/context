/**
 * @file The shared branch-context producer.
 *
 * `buildBranchContext` collects a single {@link BranchContextData} snapshot from
 * git and `gh`, honouring {@link BranchContextOptions} to decide which sections
 * to gather. Both the text renderer (`context git`) and the JSON renderer
 * (the OpenCode branch-context plugin) format that one snapshot, so the two
 * consumers can never drift.
 */
import { Clock, Effect, Schema } from "effect";
import {
  CommandExecutor,
  type CommandError,
} from "../../services/CommandExecutor.js";
import { gitOutput as runGitOutput } from "../../lib/git.js";
import { escapeTextControls } from "../../lib/text.js";
import { GitHub } from "../services/GitHub.js";
import { parseDefaultBranch, resolveDefaultRemote } from "../remotes.js";
import { formatRelativeTimeAgo } from "../services/relativeTime.js";
import { collectPullRequest } from "./pullRequest.js";
import {
  fileChange,
  parseNameStatusZ,
  parseNumstatZ,
  parseShortStatusZ,
  parseUntrackedZ,
  type DiffCounts,
} from "./parsing.js";
import type {
  BranchContextData,
  BranchContextOptions,
  BranchDiff,
  BranchMetadata,
  CommitRange,
  CommitRecord,
  CommitsSection,
  DiffSection,
  FileChange,
  RemoteDetail,
  PullRequestData,
  WorkingTreeStatus,
  WorkScope,
} from "./model.js";

/**
 * Minimum number of recent commits to list when HEAD is on the repo's default
 * branch. On a feature branch the full set of branch-unique commits is listed.
 */
const MIN_RECENT_COMMIT_LIMIT = 10;

/** Maximum number of default-branch recent commits to include in context. */
const MAX_RECENT_COMMIT_LIMIT = 20;

/** NUL-delimited token that identifies a commit header in log output. */
const COMMIT_MARKER = "context-commit";

class BranchContextError extends Schema.TaggedErrorClass<BranchContextError>()(
  "BranchContextError",
  {
    message: Schema.String,
  },
) {}

function commandFailure(
  args: readonly string[],
  error: CommandError,
): BranchContextError {
  const detail = error.stderr.trim() || error.reason;
  return new BranchContextError({
    message: escapeTextControls(
      `git ${args.join(" ")} failed with exit ${error.exitCode}: ${detail}`,
    ),
  });
}

/** Run mandatory Git collection and escape diagnostics on failure. */
function gitOutput(
  args: readonly string[],
): Effect.Effect<string, BranchContextError, CommandExecutor> {
  return runGitOutput(args).pipe(
    Effect.mapError(
      (error) =>
        new BranchContextError({
          message: escapeTextControls(error.message),
        }),
    ),
  );
}

/** Run a named optional probe where an ordinary Git exit means unavailable. */
function probeGit(
  args: readonly string[],
): Effect.Effect<string | null, BranchContextError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    return yield* executor.run("git", args).pipe(
      Effect.map((output) => output.trim()),
      Effect.catchTag("CommandError", (error) =>
        error.reason === "exit"
          ? Effect.succeed(null)
          : Effect.fail(commandFailure(args, error)),
      ),
    );
  });
}

/** Check a ref where exit code 1 means the ref does not exist. */
function gitRefExists(
  ref: string,
): Effect.Effect<boolean, BranchContextError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    return yield* executor
      .run("git", ["rev-parse", "--verify", "--quiet", ref])
      .pipe(
        Effect.as(true),
        Effect.catchTag("CommandError", (error) =>
          error.reason === "exit" && error.exitCode === 1
            ? Effect.succeed(false)
            : Effect.fail(
                commandFailure(
                  ["rev-parse", "--verify", "--quiet", ref],
                  error,
                ),
              ),
        ),
      );
  });
}

/**
 * Parse NUL-delimited `git log --numstat` output into a
 * per-commit map of path → counts, keyed by full commit hash.
 */
function parseNumstatLog(output: string): Map<string, Map<string, DiffCounts>> {
  const byCommit = new Map<string, Map<string, DiffCounts>>();
  const fields = output.split("\0");
  for (let index = 0; index < fields.length - 1;) {
    if ((fields[index] ?? "").replace(/^\n+/, "") !== COMMIT_MARKER) {
      index += 1;
      continue;
    }
    const hash = fields[index + 1] ?? "";
    index += 2;
    const start = index;
    while (
      index < fields.length - 1 &&
      (fields[index] ?? "").replace(/^\n+/, "") !== COMMIT_MARKER
    ) {
      index += 1;
    }
    const records = fields.slice(start, index);
    while (records[0] === "") records.shift();
    if (records[0] !== undefined) records[0] = records[0].replace(/^\n+/, "");
    byCommit.set(hash, parseNumstatZ(`${records.join("\0")}\0`));
  }
  return byCommit;
}

/** Parse `git rev-list --left-right --count base...HEAD` output. */
function parseAheadBehind(
  output: string,
): { ahead: number; behind: number } | null {
  const fields = output.trim().split(/\s+/);
  if (fields.length !== 2) return null;
  const [behindText, aheadText] = fields;
  const behind = Number(behindText);
  const ahead = Number(aheadText);
  return Number.isSafeInteger(ahead) &&
    ahead >= 0 &&
    Number.isSafeInteger(behind) &&
    behind >= 0
    ? { ahead, behind }
    : null;
}

/** Strip credentials from HTTP(S) remote URLs before exposing them to agents. */
function sanitiseRemoteUrl(url: string): string {
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url.replace(/^(https?:\/\/)[^/@]+@/i, "$1");
  }
}

/**
 * Build the full structured branch-context snapshot. Mandatory Git collection
 * failures propagate; a missing worktree resolves to `{ inRepo: false }` and PR
 * collection failures degrade to warnings.
 */
export function buildBranchContext(
  options: BranchContextOptions,
): Effect.Effect<BranchContextData, Error, CommandExecutor | GitHub> {
  return Effect.gen(function* () {
    const warnings: string[] = [];

    const inRepo =
      (yield* probeGit(["rev-parse", "--is-inside-work-tree"])) === "true";
    if (!inRepo) {
      return { inRepo: false, pullRequest: null, warnings };
    }

    const remotesOutput = yield* gitOutput(["remote"]);
    const { remote, remotes } = resolveDefaultRemote(remotesOutput);

    const symbolicRef = remote
      ? yield* probeGit(["symbolic-ref", `refs/remotes/${remote}/HEAD`])
      : null;
    const defaultBranch =
      remote && symbolicRef ? parseDefaultBranch(symbolicRef, remote) : null;

    const branch = (yield* gitOutput(["branch", "--show-current"])).trim();
    const onDefaultBranch = defaultBranch ? branch === defaultBranch : null;
    const repositoryRoot = (yield* gitOutput([
      "rev-parse",
      "--show-toplevel",
    ])).trim();
    const repositoryName =
      repositoryRoot.split("/").filter(Boolean).pop() ?? "";
    const headSha = (yield* gitOutput(["rev-parse", "--short", "HEAD"])).trim();

    // Compare against the branch's upstream tracking ref so locally committed
    // work that has not been pushed yet always shows. Fall back to the remote's
    // default branch when no upstream is set.
    const upstream = yield* probeGit([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const defaultBranchRef =
      remote && defaultBranch ? `${remote}/${defaultBranch}` : null;
    const baseRef = upstream ?? defaultBranchRef;
    const baseExists = baseRef ? yield* gitRefExists(baseRef) : false;
    const aheadBehind = baseExists
      ? parseAheadBehind(
          yield* gitOutput([
            "rev-list",
            "--left-right",
            "--count",
            `${baseRef}...HEAD`,
          ]),
        )
      : null;
    if (baseExists && !aheadBehind) {
      return yield* new BranchContextError({
        message: `Unable to parse ahead/behind counts for '${baseRef}'.`,
      });
    }
    const ahead = aheadBehind?.ahead ?? null;
    const behind = aheadBehind?.behind ?? null;

    const defaultRefExists =
      onDefaultBranch === false && defaultBranchRef
        ? yield* gitRefExists(defaultBranchRef)
        : false;
    const forkBase = defaultRefExists ? defaultBranchRef : null;

    const branchMetadata: BranchMetadata | undefined = options.branchMetadata
      ? {
          currentBranch: branch,
          repositoryRoot,
          repositoryName,
          headSha,
          defaultRemote: remote,
          defaultBranch,
          baseRef,
          upstreamRef: upstream ?? "",
          ahead,
          behind,
          onDefaultBranch,
          remotes,
          ...(options.remoteDetails
            ? { remoteDetails: yield* collectRemoteDetails(remotes) }
            : {}),
        }
      : undefined;

    const status = options.status ? yield* collectStatus() : undefined;

    const workScope = options.workScope
      ? onDefaultBranch === true
        ? ({
            state: "not-applicable",
            reason: "default-branch",
          } as const)
        : forkBase
          ? yield* collectWorkScope(forkBase)
          : ({
              state: "unresolved",
              reason: "Default branch is unresolved.",
            } as const)
      : undefined;
    if (workScope?.state === "unresolved")
      warnings.push(
        "Skipped work-scope collection: default branch is unresolved.",
      );

    const commits = yield* collectCommits(forkBase, baseRef, options.since);

    const diffs = yield* collectDiffs(options, {
      branch,
      defaultBranch,
      defaultBranchRef,
      onDefaultBranch,
      defaultRefExists,
    });

    const prResult: {
      data: PullRequestData | null;
      warnings: readonly string[];
    } =
      options.pullRequest && branch && onDefaultBranch === false
        ? yield* collectPullRequest(options)
        : { data: null, warnings: [] };
    if (options.pullRequest && branch && onDefaultBranch === null) {
      warnings.push(
        "Skipped pull request collection: default branch is unresolved.",
      );
    }
    warnings.push(...prResult.warnings);

    return {
      inRepo,
      branchMetadata,
      status,
      workScope,
      commits,
      diffs,
      pullRequest: prResult.data,
      warnings,
    };
  }).pipe(Effect.withSpan("branchContext.build"));
}

/** Collect working-tree status: unstaged/staged file lists plus `-sb` text. */
function collectStatus(): Effect.Effect<
  WorkingTreeStatus,
  Error,
  CommandExecutor
> {
  return Effect.gen(function* () {
    // `--name-status` gives the change type (M/A/D/R); `--numstat` gives line
    // counts. Git emits only one when both are passed, so fetch separately.
    const unstaged = parseNameStatusZ(
      yield* gitOutput(["diff", "--name-status", "-z"]),
      parseNumstatZ(yield* gitOutput(["diff", "--numstat", "-z"])),
    );
    const staged = parseNameStatusZ(
      yield* gitOutput(["diff", "--cached", "--name-status", "-z"]),
      parseNumstatZ(yield* gitOutput(["diff", "--cached", "--numstat", "-z"])),
    );
    const untracked = parseUntrackedZ(
      yield* gitOutput(["ls-files", "--others", "--exclude-standard", "-z"]),
    );
    const short = parseShortStatusZ(
      yield* gitOutput(["status", "--short", "--branch", "-z"]),
    );
    return { unstaged, staged, untracked, short };
  });
}

/** Collect optional remote URL details for agent repository disambiguation. */
function collectRemoteDetails(
  remotes: readonly string[],
): Effect.Effect<readonly RemoteDetail[], Error, CommandExecutor> {
  return Effect.gen(function* () {
    const details: RemoteDetail[] = [];
    for (const name of remotes) {
      details.push({
        name,
        fetchUrl: sanitiseRemoteUrl(
          (yield* gitOutput(["remote", "get-url", name])).trim(),
        ),
        pushUrl: sanitiseRemoteUrl(
          (yield* gitOutput(["remote", "get-url", "--push", name])).trim(),
        ),
      });
    }
    return details;
  });
}

/**
 * Collect mandatory branch-scope aggregates against a resolved fork base.
 */
function collectWorkScope(
  forkBase: string,
): Effect.Effect<WorkScope, Error, CommandExecutor> {
  return Effect.gen(function* () {
    const commitFields = (yield* gitOutput([
      "log",
      "-z",
      "--format=%h%x00%s",
      `${forkBase}..HEAD`,
    ])).split("\0");
    const branchCommits: { hash: string; subject: string }[] = [];
    for (let index = 0; index + 1 < commitFields.length; index += 2) {
      const hash = (commitFields[index] ?? "").replace(/^\n+/, "");
      if (hash)
        branchCommits.push({ hash, subject: commitFields[index + 1] ?? "" });
    }

    const branchFiles = parseNameStatusZ(
      yield* gitOutput(["diff", "--name-status", "-z", `${forkBase}...HEAD`]),
      parseNumstatZ(
        yield* gitOutput(["diff", "--numstat", "-z", `${forkBase}...HEAD`]),
      ),
    );
    const branchDiffStat = (yield* gitOutput([
      "diff",
      "--stat",
      `${forkBase}...HEAD`,
    ])).trim();

    return {
      state: "collected",
      baseRef: forkBase,
      branchCommits,
      branchFiles,
      branchDiffStat,
    };
  });
}

/** Collect the recent-commit list (git-context core) with push markers. */
function collectCommits(
  forkBase: string | null,
  baseRef: string | null,
  since: string | undefined,
): Effect.Effect<CommitsSection, Error, CommandExecutor> {
  return Effect.gen(function* () {
    // A commit is "pushed" when it is reachable from the base ref. `rev-list
    // base..HEAD` lists exactly the local commits not yet on the remote.
    const baseExists = baseRef ? yield* gitRefExists(baseRef) : false;
    const aheadOutput = baseExists
      ? yield* gitOutput(["rev-list", `${baseRef}..HEAD`])
      : "";
    const aheadHashes = new Set(
      aheadOutput
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );

    const range = yield* resolveCommitRange(forkBase, since);

    const logOutput = yield* gitOutput([
      "log",
      "--name-status",
      "-z",
      `--format=${COMMIT_MARKER}%x00%H%x00%h%x00%cI%x00%s%x00`,
      ...range.args,
    ]);
    const numstatLog = yield* gitOutput([
      "log",
      "--numstat",
      "-z",
      `--format=${COMMIT_MARKER}%x00%H%x00`,
      ...range.args,
    ]);
    const now = yield* Clock.currentTimeMillis;
    const records = parseCommits(
      logOutput,
      aheadHashes,
      baseExists,
      parseNumstatLog(numstatLog),
      now,
    );
    return { range, records };
  });
}

/** Collect full-diff blocks requested by `--diff` / `--branch-diff`. */
function collectDiffs(
  options: BranchContextOptions,
  context: BranchDiffContext,
): Effect.Effect<DiffSection | undefined, Error, CommandExecutor> {
  return Effect.gen(function* () {
    if (!options.diff && !options.branchDiff) return undefined;

    const unstaged = options.diff ? yield* gitOutput(["diff"]) : undefined;
    const staged = options.diff
      ? yield* gitOutput(["diff", "--cached"])
      : undefined;
    const branch = options.branchDiff
      ? yield* resolveBranchDiff(context)
      : undefined;

    return {
      ...(unstaged !== undefined ? { unstaged } : {}),
      ...(staged !== undefined ? { staged } : {}),
      ...(branch !== undefined ? { branch } : {}),
    };
  });
}

/** Inputs needed to resolve the `--branch-diff` section. */
interface BranchDiffContext {
  readonly branch: string;
  readonly defaultBranch: string | null;
  readonly defaultBranchRef: string | null;
  readonly onDefaultBranch: boolean | null;
  readonly defaultRefExists: boolean;
}

/**
 * Compute the merge-base diff of HEAD against the default branch. Fails (with a
 * CLI-friendly message) when HEAD is on the default branch or the default
 * branch ref or merge base cannot be resolved.
 */
function resolveBranchDiff(
  context: BranchDiffContext,
): Effect.Effect<BranchDiff, Error, CommandExecutor> {
  return Effect.gen(function* () {
    if (context.onDefaultBranch) {
      return yield* new BranchContextError({
        message: `On the default branch (${context.defaultBranch}); --branch-diff requires a feature branch.`,
      });
    }
    if (!context.defaultRefExists || !context.defaultBranchRef) {
      return yield* new BranchContextError({
        message: "Cannot resolve the default branch ref for --branch-diff.",
      });
    }

    const mergeBase = yield* probeGit([
      "merge-base",
      context.defaultBranchRef,
      "HEAD",
    ]);
    if (!mergeBase) {
      return yield* new BranchContextError({
        message: `Cannot find a merge base between ${context.defaultBranchRef} and HEAD for --branch-diff.`,
      });
    }

    const diff = yield* gitOutput(["diff", mergeBase]);
    return {
      ref: context.defaultBranchRef,
      mergeBase: mergeBase.slice(0, 7),
      diff,
    };
  });
}

/**
 * Build the trailing `git log` revision arguments and heading metadata that
 * scope which commits the context lists. On a feature branch, list every commit
 * unique to the branch; on the default branch, list whichever is larger: the
 * commits from today (capped at {@link MAX_RECENT_COMMIT_LIMIT}) or the last
 * {@link MIN_RECENT_COMMIT_LIMIT} commits.
 */
function resolveCommitRange(
  forkBase: string | null,
  since: string | undefined,
): Effect.Effect<CommitRange, Error, CommandExecutor> {
  return Effect.gen(function* () {
    if (forkBase) {
      return {
        args: [`${forkBase}..HEAD`],
        kind: "branch",
        sinceRef: forkBase,
      };
    }
    if (since) {
      return { args: ["--since", since, "HEAD"], kind: "since", since };
    }

    const total = Number(
      (yield* gitOutput([
        "rev-list",
        "--count",
        "--since=midnight",
        "HEAD",
      ])).trim(),
    );
    if (!Number.isSafeInteger(total) || total < 0) {
      return yield* new BranchContextError({
        message: "Unable to parse today's commit count.",
      });
    }
    const limit = Math.min(
      MAX_RECENT_COMMIT_LIMIT,
      Math.max(MIN_RECENT_COMMIT_LIMIT, total),
    );
    const args = ["-n", String(limit), "HEAD"];
    return total > MIN_RECENT_COMMIT_LIMIT
      ? { args, kind: "today", total, limit }
      : { args, kind: "recent" };
  });
}

/**
 * Parse `git log --name-status` output into structured commit records, marking
 * each as pushed or local and merging per-file line counts.
 */
function parseCommits(
  logOutput: string,
  aheadHashes: ReadonlySet<string>,
  baseExists: boolean,
  numstatByCommit: Map<string, Map<string, DiffCounts>>,
  now: number,
): CommitRecord[] {
  const records: {
    shortHash: string;
    relativeTime: string;
    subject: string;
    pushed: boolean;
    isoDate: string;
    files: FileChange[];
  }[] = [];
  const fields = logOutput.split("\0");
  for (let index = 0; index < fields.length - 1;) {
    const marker = (fields[index++] ?? "").replace(/^\n+/, "");
    if (marker !== COMMIT_MARKER) continue;
    const fullHash = fields[index++] ?? "";
    const shortHash = fields[index++] ?? "";
    const isoDate = fields[index++] ?? "";
    const subject = fields[index++] ?? "";
    const files: FileChange[] = [];
    const counts = numstatByCommit.get(fullHash) ?? new Map();
    while (
      index < fields.length - 1 &&
      (fields[index] ?? "").replace(/^\n+/, "") !== COMMIT_MARKER
    ) {
      const status = (fields[index++] ?? "").replace(/^\n+/, "");
      if (!status) continue;
      const firstPath = fields[index++] ?? "";
      if (!firstPath) continue;
      if (status.startsWith("R") || status.startsWith("C")) {
        const path = fields[index++] ?? "";
        if (path) files.push(fileChange(status, path, counts, firstPath));
      } else {
        files.push(fileChange(status, firstPath, counts));
      }
    }
    records.push({
      isoDate,
      shortHash,
      relativeTime: formatRelativeTimeAgo(isoDate, now),
      subject,
      pushed: baseExists && !aheadHashes.has(fullHash),
      files,
    });
  }

  return records;
}
