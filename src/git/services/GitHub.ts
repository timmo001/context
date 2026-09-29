import {
  Gh,
  GhCommandError,
  isRateLimited,
  isTransient,
  RateLimit,
  type GhError,
} from "@timmo001/effect-gh";
import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Match,
  Predicate,
  Schedule,
  Schema,
  Stream,
} from "effect";
import {
  DEFAULT_COMMAND_MAX_OUTPUT_BYTES,
  DEFAULT_COMMAND_TIMEOUT_MS,
} from "../../lib/env.js";

/** Retry and rate-limit settings, read once at the composition root. */
export interface GitHubSettings {
  /** Default retries after the initial attempt. */
  readonly retries: number;
  /** How long a REST rate-limit snapshot stays fresh. */
  readonly rateLimitTtlSeconds: number;
  /** Requests that must remain before a command is allowed to run. */
  readonly rateLimitMinRemaining: number;
  /** Longest wait for a rate-limit reset before failing instead. */
  readonly rateLimitMaxWaitSeconds: number;
}

/** Domain error for GitHub CLI/API operations. */
class GitHubError extends Schema.TaggedError<GitHubError>()("GitHubError", {
  command: Schema.String,
  exitCode: Schema.Finite,
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

interface Diagnostics {
  stdout: string;
  stderr: string;
}

type GitHubAttemptOutcome =
  | { readonly type: "success"; readonly output: string }
  | { readonly type: "output_limit" }
  | {
      readonly type: "rate_limit_exhausted";
      readonly resetEpochSeconds: number;
    };

/** Effect service for GitHub CLI/API communication. */
export class GitHub extends Context.Service<GitHub, GitHubService>()("GitHub") {
  static readonly layer = (settings: GitHubSettings) =>
    Layer.effect(
      GitHub,
      Effect.gen(function* () {
        const gh = yield* Gh;

        const rateLimits = yield* RateLimit.cached(
          Duration.seconds(settings.rateLimitTtlSeconds),
        );

        const execute = Effect.fn("GitHub.execute")(function* (
          args: readonly string[],
          diagnostics: Diagnostics,
        ) {
          let bytes = 0;
          let limited = false;
          diagnostics.stdout = "";
          diagnostics.stderr = "";
          // Keep streamed diagnostics: SDK command errors omit stdout and cap stderr.
          yield* gh.stream(args, { timeout: DEFAULT_COMMAND_TIMEOUT_MS }).pipe(
            Stream.takeWhile((chunk) => {
              const encoded = new TextEncoder().encode(chunk.text);

              const accepted = Math.min(
                encoded.byteLength,
                DEFAULT_COMMAND_MAX_OUTPUT_BYTES - bytes,
              );

              const text =
                accepted === encoded.byteLength
                  ? chunk.text
                  : new TextDecoder().decode(encoded.subarray(0, accepted));

              if (Predicate.isTagged(chunk, "Stdout"))
                diagnostics.stdout += text;
              else diagnostics.stderr += text;
              bytes += accepted;
              limited = accepted < encoded.byteLength;

              return !limited;
            }),
            Stream.runDrain,
            Effect.mapError((error) =>
              error instanceof GhCommandError
                ? new GhCommandError({
                    executable: error.executable,
                    exitCode: error.exitCode,
                    stdout: diagnostics.stdout,
                    stdoutTruncated: false,
                    stderr: diagnostics.stderr,
                    stderrTruncated: false,
                  })
                : error,
            ),
          );

          return limited
            ? ({ type: "output_limit" } as const)
            : ({ type: "success", output: diagnostics.stdout } as const);
        });

        const getRateLimit = Effect.fn("GitHub.getRateLimit")(function* () {
          return yield* Cache.get(rateLimits, "core").pipe(
            Effect.orElseSucceed(() => null),
          );
        });

        const ensureRateLimit = Effect.fn("GitHub.ensureRateLimit")(function* (
          args: readonly string[],
        ) {
          if (args[0] === "api" && args[1] === "rate_limit") return null;
          const snapshot = yield* getRateLimit();

          if (!snapshot || snapshot.remaining > settings.rateLimitMinRemaining)
            return null;
          const now = yield* Clock.currentTimeMillis;

          const resetInSeconds = Math.max(
            0,
            snapshot.reset - Math.floor(now / 1000),
          );

          if (resetInSeconds <= settings.rateLimitMaxWaitSeconds) {
            yield* Effect.sleep(Duration.seconds(resetInSeconds + 1));
            yield* Cache.invalidate(rateLimits, "core");

            return null;
          }

          return {
            type: "rate_limit_exhausted",
            resetEpochSeconds: snapshot.reset,
          } as const;
        });

        const run = Effect.fn("GitHub.run")(function* (
          args: readonly string[],
          opts?: GitHubCommandOptions,
        ): Effect.fn.Return<string, GitHubError> {
          const diagnostics: Diagnostics = { stdout: "", stderr: "" };

          // Every attempt, including retries, checks the rate limit first.
          const attempt = Effect.gen(function* () {
            const exhausted: GitHubAttemptOutcome | null =
              opts?.checkRateLimit === false
                ? null
                : yield* ensureRateLimit(args);

            return exhausted ?? (yield* execute(args, diagnostics));
          }).pipe(
            Effect.tapError((error) =>
              isRateLimited(error)
                ? Cache.invalidate(rateLimits, "core")
                : Effect.void,
            ),
          );

          const outcome = yield* attempt.pipe(
            Gh.retryTransient({
              times: opts?.retries ?? settings.retries,
              schedule: Schedule.exponential("1 second"),
            }),
            Effect.mapError((error) => toGitHubError(args, error, diagnostics)),
          );

          return yield* Match.value(outcome).pipe(
            Match.discriminatorsExhaustive("type")({
              success: ({ output }) => Effect.succeed(output),
              output_limit: () =>
                Effect.fail(
                  new GitHubError({
                    command: formatGhCommand(args),
                    exitCode: -1,
                    reason: "output_limit",
                    stdout: diagnostics.stdout,
                    stderr: diagnostics.stderr,
                    retryable: false,
                    rateLimited: false,
                  }),
                ),
              rate_limit_exhausted: ({ resetEpochSeconds }) =>
                Effect.fail(
                  new GitHubError({
                    command: formatGhCommand(args),
                    exitCode: 1,
                    reason: "exit",
                    stdout: "",
                    stderr: `GitHub REST API rate limit exhausted; resets at ${new Date(resetEpochSeconds * 1000).toISOString()}`,
                    retryable: false,
                    rateLimited: true,
                  }),
                ),
            }),
          );
        });

        const json = (args: readonly string[], opts?: GitHubCommandOptions) =>
          run(args, opts).pipe(
            Effect.flatMap((output) =>
              Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(
                output,
              ).pipe(
                Effect.mapError(
                  (error) =>
                    new GitHubError({
                      command: formatGhCommand(args),
                      exitCode: 1,
                      reason: "exit",
                      stdout: output,
                      stderr: error.message,
                      retryable: false,
                      rateLimited: false,
                    }),
                ),
              ),
            ),
          );

        return { run, json };
      }),
    );
}

function toGitHubError(
  args: readonly string[],
  error: GhError,
  diagnostics: Diagnostics,
): GitHubError {
  const stderr =
    Predicate.isTagged(error, "GhPlatformError") ||
    Predicate.isTagged(error, "GhDecodeError")
      ? diagnostics.stderr ||
        (error.cause instanceof Error
          ? error.cause.message
          : String(error.cause))
      : diagnostics.stderr;

  return new GitHubError({
    command: formatGhCommand(args),
    exitCode: error instanceof GhCommandError ? error.exitCode : -1,
    reason: Match.value(error).pipe(
      Match.tag("GhTimeoutError", () => "timeout" as const),
      Match.tag("GhPlatformError", () => "spawn" as const),
      Match.orElse(() => "exit" as const),
    ),
    stdout: diagnostics.stdout,
    stderr,
    retryable: isTransient(error),
    rateLimited: isRateLimited(error),
  });
}

function formatGhCommand(args: readonly string[]): string {
  return `gh ${args.join(" ")}`;
}
