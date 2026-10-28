import { NodeServices } from "@effect/platform-node";
import { layer as ghLayer } from "@timmo001/effect-gh";
import { Effect, Layer, type FileSystem } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { resolve } from "node:path";
import { buildBranchContext } from "./git/context/build.js";
import {
  GIT_CONTEXT_DEFAULTS,
  type BranchContextOptions,
} from "./git/context/model.js";
import {
  branchContextJsonPayload,
  type BranchContextJson,
} from "./git/context/renderJson.js";
import {
  GITHUB_DEFAULTS,
  GitHub,
  type GitHubSettings,
} from "./git/services/GitHub.js";
import {
  DEFAULT_COMMAND_MAX_OUTPUT_BYTES,
  DEFAULT_COMMAND_TIMEOUT_MS,
} from "./lib/env.js";
import { CommandExecutor } from "./services/CommandExecutor.js";
import { detectStack } from "./stack/context/detect.js";
import {
  STACK_CONTEXT_DEFAULTS,
  type StackContextOptions,
} from "./stack/context/model.js";
import {
  stackContextJsonPayload,
  type StackContextJson,
} from "./stack/context/renderJson.js";

/** Options for {@link gitContext}: the repository directory plus any option overrides. */
export type GitContextOptions = Partial<BranchContextOptions> & {
  /** Directory every git and `gh` call runs in. */
  readonly cwd: string;
};

/** Options for {@link stackContext}: the directory to scan plus any walk-cap overrides. */
export type StackContextInput = Partial<StackContextOptions> & {
  /** Directory to scan. A relative path resolves against the process's working directory. */
  readonly root: string;
};

/** Services the stack scan needs; {@link ContextLayer.make} provides them. */
export type StackContextServices =
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;

/**
 * Collect branch context for the repository at `cwd` and return the bounded
 * JSON payload `context git --json` prints. Unset options use
 * {@link GIT_CONTEXT_DEFAULTS}.
 */
export function gitContext(
  options: GitContextOptions,
): Effect.Effect<BranchContextJson, Error, CommandExecutor | GitHub> {
  const { cwd, ...overrides } = options;

  return buildBranchContext(
    { ...GIT_CONTEXT_DEFAULTS, ...overrides },
    cwd,
  ).pipe(Effect.map(branchContextJsonPayload), Effect.withSpan("context.git"));
}

/**
 * Detect the tech stack under `root` and return the bounded JSON payload
 * `context stack --json` prints. Unset walk caps use
 * {@link STACK_CONTEXT_DEFAULTS}.
 */
export function stackContext(
  options: StackContextInput,
): Effect.Effect<StackContextJson, never, StackContextServices> {
  return detectStack({
    root: resolve(options.root),
    maxDepth: options.maxDepth ?? STACK_CONTEXT_DEFAULTS.maxDepth,
    maxFiles: options.maxFiles ?? STACK_CONTEXT_DEFAULTS.maxFiles,
    topLocations: options.topLocations ?? STACK_CONTEXT_DEFAULTS.topLocations,
  }).pipe(
    Effect.map(stackContextJsonPayload),
    Effect.withSpan("context.stack"),
  );
}

/** Options for {@link ContextLayer.make}. */
export interface ContextLayerOptions {
  /** Default working directory for every git and `gh` command. */
  readonly cwd: string;
  /** GitHub retry and rate-limit overrides on {@link GITHUB_DEFAULTS}. */
  readonly github?: Partial<GitHubSettings>;
}

/** Layers that provide everything {@link gitContext} and {@link stackContext} need. */
export const ContextLayer = {
  /**
   * Provide {@link CommandExecutor} and {@link GitHub}, both running commands
   * in `cwd`, on top of the Node platform services.
   */
  make: (options: ContextLayerOptions) =>
    Layer.mergeAll(
      CommandExecutor.layerAt(options.cwd),
      GitHub.layer({ ...GITHUB_DEFAULTS, ...options.github }).pipe(
        Layer.provide(
          ghLayer({
            cwd: options.cwd,
            timeout: DEFAULT_COMMAND_TIMEOUT_MS,
            maxOutputBytes: DEFAULT_COMMAND_MAX_OUTPUT_BYTES,
          }),
        ),
      ),
    ).pipe(Layer.provideMerge(NodeServices.layer)),
};
