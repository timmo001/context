import { Gh } from "@timmo001/effect-gh";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Schema,
  Stream,
} from "effect";
import {
  DEFAULT_COMMAND_MAX_OUTPUT_BYTES,
  DEFAULT_COMMAND_TIMEOUT_MS,
  ENV,
  envNonNegativeInt,
} from "../../lib/env.js";

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
class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
  command: Schema.String,
  exitCode: Schema.Number,
  reason: Schema.Literals(["spawn", "exit", "timeout", "output_limit"]),
  stdout: Schema.String,
  stderr: Schema.String,
  retryable: Schema.Boolean,
  rateLimited: Schema.Boolean,
}) {}

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
  ) => Effect.Effect<Schema.Json, GitHubError>;
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
      const gh = yield* Gh;
      let rateLimitCache: RateLimitSnapshot | null = null;

      const execute = Effect.fn("GitHub.execute")(function* (
        args: readonly string[],
      ) {
        let stdout = "";
        let stderr = "";
        let bytes = 0;
        // Keep streamed diagnostics: SDK command errors omit stdout and cap stderr.
        yield* gh.stream(args, { timeout: DEFAULT_COMMAND_TIMEOUT_MS }).pipe(
          Stream.mapError((error) =>
            toGitHubError(args, {
              exitCode: error._tag === "GhCommandError" ? error.exitCode : -1,
              reason:
                error._tag === "GhTimeoutError"
                  ? "timeout"
                  : error._tag === "GhPlatformError"
                    ? "spawn"
                    : "exit",
              stdout,
              stderr:
                error._tag === "GhPlatformError" ||
                error._tag === "GhDecodeError"
                  ? stderr ||
                    (error.cause instanceof Error
                      ? error.cause.message
                      : String(error.cause))
                  : stderr,
            }),
          ),
          Stream.runForEach((chunk) =>
            Effect.gen(function* () {
              const encoded = new TextEncoder().encode(chunk.text);
              const accepted = Math.min(
                encoded.byteLength,
                DEFAULT_COMMAND_MAX_OUTPUT_BYTES - bytes,
              );
              const text =
                accepted === encoded.byteLength
                  ? chunk.text
                  : new TextDecoder().decode(encoded.subarray(0, accepted));
              if (chunk._tag === "Stdout") stdout += text;
              else stderr += text;
              bytes += accepted;
              if (accepted < encoded.byteLength) {
                return yield* toGitHubError(args, {
                  exitCode: -1,
                  reason: "output_limit",
                  stdout,
                  stderr,
                });
              }
            }),
          ),
        );
        return stdout;
      });

      const fetchRateLimit = Effect.fn("GitHub.fetchRateLimit")(function* (
        checkedAtMillis: number,
      ) {
        const raw = yield* execute([
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
        execute(args).pipe(
          Effect.matchEffect({
            onSuccess: (output) =>
              Effect.succeed({ type: "success" as const, output }),
            onFailure: (error) =>
              Effect.succeed({
                type: "failure" as const,
                error,
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
              try: () =>
                Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
                  output,
                ),
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
  error: Pick<GitHubError, "exitCode" | "reason" | "stdout" | "stderr">,
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
