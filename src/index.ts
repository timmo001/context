import { Effect, Layer, Schema } from "effect";
import { NodeRuntime } from "@effect/platform-node";
import { renderHelp } from "./cli/help.js";
import { getCliCommand, nativeCommandNames } from "./cli/spec.js";
import { hasOption, optionValue, parseSince } from "./cli/args.js";
import {
  isCompletionShell,
  renderCompletions,
  shellList,
} from "./cli/completions.js";
import {
  gitContextOptions,
  gitContextRaw,
  gitContextRawJson,
} from "./git/commands/Context.js";
import {
  stackContextOptions,
  stackContextRaw,
  stackContextRawJson,
} from "./stack/commands/Context.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { GitHub } from "./git/services/GitHub.js";
import { mcpServer, mcpTeardown } from "./mcp/commands/Mcp.js";

type ParsedArgs = {
  readonly command: string | undefined;
  readonly rest: readonly string[];
  readonly help: boolean;
};

class UsageError extends Schema.TaggedErrorClass<UsageError>()("UsageError", {
  message: Schema.String,
}) {}

function parseArgs(args: readonly string[]): ParsedArgs {
  const [first, ...rest] = args;
  if (!first) return { command: undefined, rest: [], help: false };
  if (first === "--help" || first === "-h") {
    return { command: undefined, rest: [], help: true };
  }
  return {
    command: first,
    rest,
    help: rest.includes("--help") || rest.includes("-h"),
  };
}

function failUsage(message: string): never {
  console.error(usageMessage(message));
  process.exit(1);
}

function usageMessage(message: string): string {
  return `${message}\nRun 'context --help' to see available commands.`;
}

function sinceOption(args: readonly string[]): string | undefined {
  const raw = optionValue(args, "--since");
  return raw ? parseSince(raw) : undefined;
}

function runGit(args: readonly string[]) {
  const options = gitContextOptions({
    diff: args.includes("--diff"),
    branchDiff: args.includes("--branch-diff"),
    since: sinceOption(args),
    description: !args.includes("--no-description"),
    labels: args.includes("--labels"),
    comments: args.includes("--comments"),
    reviews: args.includes("--reviews"),
    checks: args.includes("--checks"),
    pullRequest: !args.includes("--no-pr"),
    branchMetadata: !args.includes("--no-branch-metadata"),
    remoteDetails: args.includes("--remotes"),
    status: !args.includes("--no-status"),
    workScope: !args.includes("--no-work-scope"),
  });
  return args.includes("--json")
    ? gitContextRawJson(options)
    : gitContextRaw(options);
}

function runStack(args: readonly string[]) {
  const dir = args.find((arg) => !arg.startsWith("-"));
  const options = stackContextOptions({ root: dir });
  return args.includes("--json")
    ? stackContextRawJson(options)
    : stackContextRaw(options, args.includes("--plain"));
}

function helpCommandArg(args: readonly string[]): string | undefined {
  return args.find((arg) => !arg.startsWith("-"));
}

function runCompletions(args: readonly string[]) {
  const shell = args.find((arg) => !arg.startsWith("-")) ?? "zsh";
  if (!isCompletionShell(shell)) {
    throw new Error(
      `context completions: unsupported shell '${shell}' (expected: ${shellList()})`,
    );
  }
  return Effect.sync(() => process.stdout.write(renderCompletions(shell)));
}

const parsed = parseArgs(process.argv.slice(2));
const command = parsed.command;

if (parsed.help && !command) {
  console.log(renderHelp());
  process.exit(0);
}

if (!command) {
  console.log(renderHelp());
  process.exit(0);
}

if (!nativeCommandNames.has(command)) {
  failUsage(`context: unknown command '${command}'`);
}

if (parsed.help && command !== "help") {
  console.log(renderHelp(command));
  process.exit(0);
}

const CliLayers = GitHub.layer.pipe(Layer.provideMerge(CommandExecutor.layer));

if (command === "mcp") {
  NodeRuntime.runMain(mcpServer.pipe(Effect.provide(CliLayers)), {
    teardown: mcpTeardown,
  });
} else {
  const effect = (() => {
    const canonical = getCliCommand(command)?.name ?? command;
    switch (canonical) {
      case "git":
        return runGit(parsed.rest);
      case "stack":
        return runStack(parsed.rest);
      case "completions":
        return runCompletions(parsed.rest);
      case "help":
        return Effect.sync(() => {
          console.log(renderHelp(helpCommandArg(parsed.rest)));
        });
      default:
        return Effect.fail(
          new UsageError({
            message: usageMessage(`context: unknown command '${command}'`),
          }),
        );
    }
  })();

  Effect.runPromise(effect.pipe(Effect.provide(CliLayers))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
