import { Effect, Schema } from "effect";
import { UsageError } from "../../cli/args.js";
import { parseSince } from "../../cli/since.js";
import { renderHelp } from "../../cli/help.js";
import {
  gitContextOptions,
  gitContextText,
} from "../../git/commands/Context.js";
import {
  stackContextOptions,
  stackContextText,
} from "../../stack/commands/Context.js";
import { GitHub } from "../../git/services/GitHub.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { mcpTools } from "../toolMetadata.js";
import {
  makeToolRegistrar,
  READONLY_HINTS,
  READONLY_OPEN_WORLD_HINTS,
} from "./register.js";

export const GitContextParams = Schema.Struct({
  diff: Schema.optional(Schema.Boolean),
  branchDiff: Schema.optional(Schema.Boolean),
  comments: Schema.optional(Schema.Boolean),
  reviews: Schema.optional(Schema.Boolean),
  labels: Schema.optional(Schema.Boolean),
  checks: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.Boolean),
  pullRequest: Schema.optional(Schema.Boolean),
  remotes: Schema.optional(Schema.Boolean),
  since: Schema.optional(Schema.String),
});

const StackContextParams = Schema.Struct({
  dir: Schema.optional(Schema.String),
});

const CommandHelpParams = Schema.Struct({
  name: Schema.optional(Schema.String),
});

function metadata(name: string) {
  const match = mcpTools.find((tool) => tool.name === name);
  if (!match) throw new Error(`Missing MCP metadata for ${name}`);
  return match;
}

/** Translate validated MCP parameters into shared git-context options. */
export function gitContextToolOptions(params: typeof GitContextParams.Type) {
  return gitContextOptions({
    diff: params.diff ?? false,
    branchDiff: params.branchDiff ?? false,
    since: params.since === undefined ? undefined : parseSince(params.since),
    comments: params.comments ?? false,
    reviews: params.reviews ?? false,
    labels: params.labels ?? false,
    checks: params.checks ?? false,
    description: params.description ?? true,
    pullRequest: params.pullRequest ?? true,
    remoteDetails: params.remotes ?? false,
  });
}

/** Register the read-only context tools. */
export const registerContextTools = Effect.gen(function* () {
  const register = yield* makeToolRegistrar;
  const executor = yield* CommandExecutor;
  const github = yield* GitHub;

  const gitMeta = metadata("git_context");
  yield* register({
    name: gitMeta.name,
    description: gitMeta.description,
    parameters: GitContextParams,
    annotations: READONLY_OPEN_WORLD_HINTS,
    handle: (params) =>
      Effect.try({
        try: () => gitContextToolOptions(params),
        catch: (error) =>
          new UsageError({
            message: error instanceof Error ? error.message : String(error),
          }),
      }).pipe(
        Effect.flatMap((options) => gitContextText(options)),
        Effect.provideService(CommandExecutor, executor),
        Effect.provideService(GitHub, github),
      ),
  });

  const stackMeta = metadata("stack_context");
  yield* register({
    name: stackMeta.name,
    description: stackMeta.description,
    parameters: StackContextParams,
    annotations: READONLY_HINTS,
    handle: (params) =>
      stackContextText(stackContextOptions({ root: params.dir })),
  });

  const helpMeta = metadata("command_help");
  yield* register({
    name: helpMeta.name,
    description: helpMeta.description,
    parameters: CommandHelpParams,
    annotations: READONLY_HINTS,
    handle: (params) => Effect.sync(() => renderHelp(params.name)),
  });
});
