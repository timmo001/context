import {
  Gh,
  isRateLimited,
  isTransient,
  RateLimit,
  type GhError,
} from "@timmo001/effect-gh";
import {
  Cache,
  Context,
  Duration,
  Effect,
  Layer,
  Match,
  Schedule,
  Schema,
} from "effect";

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

/** Options for GitHub operations. */
interface GitHubCommandOptions {
  /** Number of retries after the initial attempt. */
  readonly retries?: number;
  /** Whether to check REST API rate-limit state before the operation. */
  readonly checkRateLimit?: boolean;
}

/** Service interface for all GitHub CLI/API communication. */
export interface GitHubService {
  /**
   * Run a typed effect-gh read with a rate-limit check and retries of
   * transient failures. `label` names the operation in errors.
   */
  readonly read: <A, R>(
    label: string,
    operation: Effect.Effect<A, GhError, R>,
    opts?: GitHubCommandOptions,
  ) => Effect.Effect<A, GitHubError, Exclude<R, Gh>>;
}

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

        const guard = (label: string) =>
          RateLimit.guard(rateLimits, {
            minRemaining: settings.rateLimitMinRemaining,
            maxWait: Duration.seconds(settings.rateLimitMaxWaitSeconds),
          }).pipe(
            Effect.mapError(
              (exhausted) =>
                new GitHubError({
                  command: label,
                  exitCode: 1,
                  reason: "exit",
                  stdout: "",
                  stderr: `GitHub REST API rate limit exhausted; resets at ${new Date(exhausted.reset * 1000).toISOString()}`,
                  retryable: false,
                  rateLimited: true,
                }),
            ),
          );

        const read: GitHubService["read"] = (label, operation, opts) => {
          // Every attempt, including retries, checks the rate limit first.
          const attempt = operation.pipe(
            Effect.tapError((error) =>
              isRateLimited(error)
                ? Cache.invalidate(rateLimits, "core")
                : Effect.void,
            ),
          );

          return (
            opts?.checkRateLimit === false
              ? attempt.pipe(
                  Effect.mapError((error) => toGitHubError(label, error)),
                )
              : guard(label).pipe(
                  Effect.andThen(
                    attempt.pipe(
                      Effect.mapError((error) => toGitHubError(label, error)),
                    ),
                  ),
                )
          ).pipe(
            Effect.retry({
              times: opts?.retries ?? settings.retries,
              schedule: Schedule.exponential("1 second"),
              while: (error) => error.retryable,
            }),
            Effect.provideService(Gh, gh),
          );
        };

        return GitHub.of({ read });
      }),
    );
}

function toGitHubError(label: string, error: GhError): GitHubError {
  const details = Match.value(error).pipe(
    Match.tag("GhCommandError", (error) => ({
      exitCode: error.exitCode,
      reason: "exit" as const,
      stdout: error.stdout,
      stderr: error.stderr,
    })),
    Match.tag("GhTimeoutError", (error) => ({
      exitCode: -1,
      reason: "timeout" as const,
      stdout: "",
      stderr: `gh timed out after ${error.timeoutMs}ms`,
    })),
    Match.tag("GhOutputLimitError", (error) => ({
      exitCode: -1,
      reason: "output_limit" as const,
      stdout: "",
      stderr: `gh output passed ${error.limitBytes} bytes`,
    })),
    Match.tag("GhPlatformError", (error) => ({
      exitCode: -1,
      reason: "spawn" as const,
      stdout: "",
      stderr:
        error.cause instanceof Error
          ? error.cause.message
          : String(error.cause),
    })),
    Match.tag("GhDecodeError", (error) => ({
      exitCode: 1,
      reason: "exit" as const,
      stdout: "",
      stderr:
        error.cause instanceof Error
          ? error.cause.message
          : String(error.cause),
    })),
    Match.exhaustive,
  );

  return new GitHubError({
    command: label,
    ...details,
    retryable: isTransient(error),
    rateLimited: isRateLimited(error),
  });
}
