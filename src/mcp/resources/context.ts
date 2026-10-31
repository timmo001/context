import { CommandExecutor, GitHub } from "@timmo001/effect-context";
import { Effect, FileSystem, Schema } from "effect";
import { McpSchema, McpServer } from "effect/ai";
import { ChildProcessSpawner } from "effect/process";
import { renderHelp } from "../../cli/help.js";
import { nativeCommandNames } from "../../cli/spec.js";
import {
  gitContextOptions,
  gitContextText,
} from "../../git/commands/Context.js";
import {
  stackContextOptions,
  stackContextText,
} from "../../stack/commands/Context.js";

const commandParam = McpSchema.param("name", Schema.String);

/** Register read-only context resources. */
export const registerContextResources = Effect.gen(function* () {
  // Resource handler services are request-level in McpServer, so capture them
  // at registration and provide them to each read, as the tools do.
  const executor = yield* CommandExecutor;
  const github = yield* GitHub;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  yield* McpServer.registerResource({
    uri: "context://git",
    name: "git context",
    description: "Concise branch context for the current repository.",
    mimeType: "text/plain",
    content: gitContextText(gitContextOptions({})).pipe(
      Effect.provideService(CommandExecutor, executor),
      Effect.provideService(GitHub, github),
    ),
  });

  yield* McpServer.registerResource({
    uri: "context://stack",
    name: "stack context",
    description: "Deterministic tech-stack summary for the current directory.",
    mimeType: "text/plain",
    content: stackContextText(stackContextOptions({})).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    ),
  });

  yield* McpServer.registerResource`context://command/${commandParam}`({
    name: "context command help",
    description: "Help text for a single context command.",
    mimeType: "text/plain",
    completion: {
      name: (input) =>
        Effect.succeed(
          [...nativeCommandNames]
            .filter((name) => name.startsWith(input))
            .sort(),
        ),
    },
    content: (_uri, name) => Effect.sync(() => renderHelp(name)),
  });
});
