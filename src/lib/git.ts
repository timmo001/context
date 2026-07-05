import { Effect, Schema } from "effect";
import {
  CommandExecutor,
  type CommandError,
} from "../services/CommandExecutor.js";

/** Options for git commands. */
export interface GitCommandOptions {
  /** Working directory for the command. */
  readonly cwd?: string;
}

/** Domain error for shared git command failures. */
class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()(
  "GitCommandError",
  {
    message: Schema.String,
  },
) {}

function commandFailureMessage(
  command: string,
  args: readonly string[],
  error: CommandError,
): string {
  const stderr = error.stderr ? `: ${error.stderr}` : "";
  return `${[command, ...args].join(" ")} failed with exit ${error.exitCode}${stderr}`;
}

/** Run `git <args>` and return stdout. */
export function gitOutput(
  args: readonly string[],
  opts?: GitCommandOptions,
): Effect.Effect<string, GitCommandError, CommandExecutor> {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    return yield* executor.run("git", args, opts).pipe(
      Effect.catchTag("CommandError", (error) =>
        Effect.fail(
          new GitCommandError({
            message: commandFailureMessage("git", args, error),
          }),
        ),
      ),
    );
  });
}
