import { Clock, Context, Duration, Effect, Layer, Schema } from "effect";
import {
  CommandExecutor,
  type CommandError,
} from "../../services/CommandExecutor.js";
import { ENV, envNonNegativeInt } from "../../lib/env.js";

const DEFAULT_RETRIES = envNonNegativeInt(ENV.CONTEXT_GITHUB_RETRIES, 2);
const RATE_LIMIT_TTL_MS =
  envNonNegativeInt(ENV.CONTEXT_GITHUB_RATE_LIMIT_TTL_SECONDS, 60) * 1000;
const RATE_LIMIT_MIN_REMAINING = envNonNegativeInt(
  ENV.CONTEXT_GITHUB_RATE_LIMIT_MIN_REMAINING,
  0,
);
const RATE_LIMIT_MAX_WAIT_SECONDS = envNonNegativeInt(
  ENV.CONTEXT_GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS,
  60,
);

/** Domain error for GitHub CLI/API operations. */
class GitHubError extends Schema.TaggedErrorClass<GitHubError>()(
  "GitHubError",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    reason: Schema.Literals(["spawn", "exit", "timeout", "output_limit"]),
    stdout: Schema.String,
    stderr: Schema.String,
    retryable: Schema.Boolean,
    rateLimited: Schema.Boolean,
  },
) {}

/** Options for GitHub CLI commands. */
interface GitHubCommandOptions {
  /** Number of retries after the initial attempt. */
  readonly retries?: number;
  /** Whether to check REST API rate-limit state before the command. */
  readonly checkRateLimit?: boolean;
}

/** Service interface for all GitHub CLI/API communication. */
export interface GitHubService {
  /** Run a raw `gh` command with rate-limit checks and retries. */
  readonly run: (
    args: readonly string[],
    opts?: GitHubCommandOptions,
  ) => Effect.Effect<string, GitHubError>;
  /** Run a `gh` command expected to return JSON and parse the response. */
  readonly json: (
    args: readonly string[],
    opts?: GitHubCommandOptions,
  ) => Effect.Effect<unknown, GitHubError>;
}

interface RateLimitSnapshot {
  readonly remaining: number;
  readonly resetEpochSeconds: number;
  readonly checkedAtMillis: number;
}

type GitHubAttemptResult =
  | { readonly type: "success"; readonly output: string }
  | { readonly type: "failure"; readonly error: GitHubError };

/** Effect service for GitHub CLI/API communication. */
export class GitHub extends Context.Service<GitHub, GitHubService>()("GitHub") {
  static readonly layer = Layer.effect(
    GitHub,
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      let rateLimitCache: RateLimitSnapshot | null = null;

      const fetchRateLimit = Effect.fn("GitHub.fetchRateLimit")(function* (
        checkedAtMillis: number,
      ) {
        const raw = yield* executor.run("gh", [
          "api",
          "rate_limit",
          "--jq",
          ".resources.core | [.remaining, .reset] | @tsv",
        ]);
        return parseRateLimit(raw, checkedAtMillis);
      });

      const getRateLimit = Effect.fn("GitHub.getRateLimit")(function* () {
        const now = yield* Clock.currentTimeMillis;
        if (
          rateLimitCache &&
          now - rateLimitCache.checkedAtMillis < RATE_LIMIT_TTL_MS
        ) {
          return rateLimitCache;
        }
        const snapshot = yield* fetchRateLimit(now).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );
        rateLimitCache = snapshot;
        return snapshot;
      });

      const guardRateLimit = Effect.fn("GitHub.guardRateLimit")(function* (
        args: readonly string[],
        snapshot: RateLimitSnapshot,
      ): Effect.fn.Return<void, GitHubError> {
        if (snapshot.remaining > RATE_LIMIT_MIN_REMAINING) return;
        const now = yield* Clock.currentTimeMillis;
        const resetInSeconds = Math.max(
          0,
          snapshot.resetEpochSeconds - Math.floor(now / 1000),
        );
        if (resetInSeconds <= RATE_LIMIT_MAX_WAIT_SECONDS) {
          yield* Effect.sleep(Duration.seconds(resetInSeconds + 1));
          rateLimitCache = null;
          return;
        }
        return yield* new GitHubError({
          command: formatGhCommand(args),
          exitCode: 1,
          reason: "exit",
          stdout: "",
          stderr: `GitHub REST API rate limit exhausted; resets at ${new Date(snapshot.resetEpochSeconds * 1000).toISOString()}`,
          retryable: false,
          rateLimited: true,
        });
      });

      const ensureRateLimit = Effect.fn("GitHub.ensureRateLimit")(function* (
        args: readonly string[],
      ) {
        if (args[0] === "api" && args[1] === "rate_limit") return;
        const snapshot = yield* getRateLimit();
        if (snapshot) yield* guardRateLimit(args, snapshot);
      });

      const runAttempt = (args: readonly string[]) =>
        executor.run("gh", args).pipe(
          Effect.matchEffect({
            onSuccess: (output) =>
              Effect.succeed({ type: "success" as const, output }),
            onFailure: (error) =>
              Effect.succeed({
                type: "failure" as const,
                error: toGitHubError(args, error),
              }),
          }),
        );

      const runWithRetry = Effect.fn("GitHub.runWithRetry")(function* (
        args: readonly string[],
        retries: number,
        attempt: number,
        checkRateLimit: boolean,
      ): Effect.fn.Return<string, GitHubError> {
        if (checkRateLimit) yield* ensureRateLimit(args);
        const result: GitHubAttemptResult = yield* runAttempt(args);
        if (result.type === "success") return result.output;
        const { error } = result;
        if (error.rateLimited) rateLimitCache = null;
        if (attempt >= retries || !error.retryable) return yield* error;
        yield* Effect.sleep(Duration.seconds(2 ** attempt));
        return yield* runWithRetry(args, retries, attempt + 1, checkRateLimit);
      });

      const run = Effect.fn("GitHub.run")(function* (
        args: readonly string[],
        opts?: GitHubCommandOptions,
      ): Effect.fn.Return<string, GitHubError> {
        return yield* runWithRetry(
          args,
          opts?.retries ?? DEFAULT_RETRIES,
          0,
          opts?.checkRateLimit !== false,
        );
      });

      const json = (args: readonly string[], opts?: GitHubCommandOptions) =>
        run(args, opts).pipe(
          Effect.flatMap((output) =>
            Effect.try({
              try: () => JSON.parse(output) as unknown,
              catch: (error) =>
                new GitHubError({
                  command: formatGhCommand(args),
                  exitCode: 1,
                  reason: "exit",
                  stdout: output,
                  stderr:
                    error instanceof Error ? error.message : String(error),
                  retryable: false,
                  rateLimited: false,
                }),
            }),
          ),
        );

      return { run, json };
    }),
  );
}

function parseRateLimit(
  raw: string,
  checkedAtMillis: number,
): RateLimitSnapshot | null {
  const [remainingRaw, resetRaw] = raw.trim().split(/\s+/, 2);
  const remaining = parseInteger(remainingRaw);
  const resetEpochSeconds = parseInteger(resetRaw);
  if (remaining === null || resetEpochSeconds === null) return null;
  return { remaining, resetEpochSeconds, checkedAtMillis };
}

function parseInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toGitHubError(
  args: readonly string[],
  error: CommandError,
): GitHubError {
  const diagnostic = `${error.stderr}\n${error.stdout}`;
  const rateLimited = isRateLimitMessage(diagnostic);
  return new GitHubError({
    command: formatGhCommand(args),
    exitCode: error.exitCode,
    reason: error.reason,
    stdout: error.stdout,
    stderr: error.stderr,
    retryable: rateLimited || isTransientMessage(diagnostic),
    rateLimited,
  });
}

function isRateLimitMessage(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return lower.includes("rate limit") || lower.includes("secondary rate");
}

function isTransientMessage(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return [
    "http 5",
    "502",
    "503",
    "504",
    "connection reset",
    "could not resolve host",
    "network is unreachable",
    "temporarily unavailable",
    "timeout",
    "tls handshake",
  ].some((pattern) => lower.includes(pattern));
}

function formatGhCommand(args: readonly string[]): string {
  return `gh ${args.join(" ")}`;
}
