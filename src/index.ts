import { NodeRuntime } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Runtime } from "effect";
import {
  hasOption,
  parseCliArgs,
  UsageError,
  type ParsedCliArgs,
} from "./cli/args.js";
import {
  isCompletionShell,
  renderCompletions,
  shellList,
} from "./cli/completions.js";
import { gitCliInvocation } from "./cli/git-options.js";
import { renderHelp } from "./cli/help.js";
import { GitHub } from "./git/services/GitHub.js";
import { formatCommandError } from "./lib/rows.js";
import { CommandExecutor } from "./services/CommandExecutor.js";

function usageMessage(message: string): string {
  return `${message}\nRun 'context --help' to see available commands.`;
}

function warnInertJsonFlags(flags: readonly string[]) {
  if (flags.length === 0) return Effect.void;
  return Effect.sync(() =>
    console.error(
      `[context git] ${flags.join(" and ")} ${flags.length === 1 ? "is" : "are"} text-only and ignored with --json.`,
    ),
  );
}

function runGit(args: ParsedCliArgs) {
  const invocation = gitCliInvocation(args);
  return Effect.promise(() => import("./git/commands/Context.js")).pipe(
    Effect.flatMap(
      ({ gitContextOptions, gitContextRaw, gitContextRawJson }) => {
        const options = gitContextOptions(invocation.options);
        return warnInertJsonFlags(invocation.inertJsonFlags).pipe(
          Effect.andThen(
            invocation.json
              ? gitContextRawJson(options)
              : gitContextRaw(options),
          ),
        );
      },
    ),
  );
}

function runStack(args: ParsedCliArgs) {
  return Effect.promise(() => import("./stack/commands/Context.js")).pipe(
    Effect.flatMap(
      ({ stackContextOptions, stackContextRaw, stackContextRawJson }) => {
        const options = stackContextOptions({ root: args.positionals[0] });
        return hasOption(args, "--json")
          ? stackContextRawJson(options)
          : stackContextRaw(options, hasOption(args, "--plain"));
      },
    ),
  );
}

function runCompletions(args: ParsedCliArgs) {
  const shell = args.positionals[0] ?? "zsh";
  if (!isCompletionShell(shell)) {
    return Effect.fail(
      new UsageError({
        message: `context completions: unsupported shell '${shell}' (expected: ${shellList()})`,
      }),
    );
  }
  return Effect.sync(() => process.stdout.write(renderCompletions(shell)));
}

function runCommand(args: ParsedCliArgs) {
  if (!args.command) {
    return Effect.sync(() => console.log(renderHelp()));
  }
  if (args.help) {
    return Effect.sync(() => console.log(renderHelp(args.command?.name)));
  }

  switch (args.command.name) {
    case "git":
      return runGit(args);
    case "stack":
      return runStack(args);
    case "mcp":
      return Effect.promise(() => import("./mcp/commands/Mcp.js")).pipe(
        Effect.flatMap(({ mcpServer }) => mcpServer),
      );
    case "completions":
      return runCompletions(args);
    case "help":
      return Effect.sync(() => console.log(renderHelp(args.positionals[0])));
    default:
      return Effect.fail(
        new UsageError({
          message: `context: unknown command '${args.command.name}'`,
        }),
      );
  }
}

function reportCliCause(cause: Cause.Cause<unknown>) {
  if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
  const error = Cause.squash(cause);
  return Effect.sync(() => {
    console.error(
      error instanceof UsageError
        ? usageMessage(error.message)
        : formatCommandError(error),
    );
    process.exitCode = 1;
  });
}

const CliLayers = GitHub.layer.pipe(Layer.provideMerge(CommandExecutor.layer));

const cliTeardown: Runtime.Teardown = (exit, onExit) =>
  Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
    ? Runtime.defaultTeardown(exit, onExit)
    : onExit(0);

const program = Effect.try({
  try: () => parseCliArgs(process.argv.slice(2)),
  catch: (error) =>
    error instanceof UsageError
      ? error
      : new UsageError({ message: formatCommandError(error) }),
}).pipe(
  Effect.flatMap(runCommand),
  Effect.provide(CliLayers),
  Effect.catchCause(reportCliCause),
);

NodeRuntime.runMain(program, {
  disableErrorReporting: true,
  teardown: cliTeardown,
});
