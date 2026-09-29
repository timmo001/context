import { Effect, type FileSystem } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import { resolve } from "node:path";
import { cliStyler, plainStyler, type Styler } from "../../lib/ansi.js";
import { writeText } from "../../lib/rows.js";
import { detectStack } from "../context/detect.js";
import {
  STACK_CONTEXT_DEFAULTS,
  type StackContextOptions,
} from "../context/model.js";
import { renderStackContextJson } from "../context/renderJson.js";
import { renderStackContextText } from "../context/renderText.js";

type StackServices =
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner;

/** Resolve full stack-context options from partial overrides on the defaults. */
export function stackContextOptions(
  overrides: Partial<StackContextOptions>,
): StackContextOptions {
  return {
    root:
      overrides.root && overrides.root.length > 0
        ? resolve(overrides.root)
        : process.cwd(),
    maxDepth: overrides.maxDepth ?? STACK_CONTEXT_DEFAULTS.maxDepth,
    maxFiles: overrides.maxFiles ?? STACK_CONTEXT_DEFAULTS.maxFiles,
    topLocations: overrides.topLocations ?? STACK_CONTEXT_DEFAULTS.topLocations,
  };
}

/** Build stack-context text output. */
export function stackContextText(
  options: StackContextOptions,
  styler: Styler = plainStyler,
): Effect.Effect<string, never, StackServices> {
  return detectStack(options).pipe(
    Effect.map((stack) => renderStackContextText(stack, styler)),
    Effect.withSpan("stackContext.text"),
  );
}

/** Build stack-context JSON output. */
export function stackContextJson(
  options: StackContextOptions,
): Effect.Effect<string, never, StackServices> {
  return detectStack(options).pipe(
    Effect.map((stack) => `${renderStackContextJson(stack)}\n`),
    Effect.withSpan("stackContext.json"),
  );
}

/** CLI: write stack-context text output to stdout. */
export function stackContextRaw(
  options: StackContextOptions,
  plain = false,
): Effect.Effect<void, never, StackServices> {
  return stackContextText(
    options,
    plain ? plainStyler : cliStyler(process.stdout),
  ).pipe(Effect.flatMap(writeText), Effect.withSpan("stackContext.raw"));
}

/** CLI: write stack-context JSON output to stdout. */
export function stackContextRawJson(
  options: StackContextOptions,
): Effect.Effect<void, never, StackServices> {
  return stackContextJson(options).pipe(
    Effect.flatMap(writeText),
    Effect.withSpan("stackContext.rawJson"),
  );
}
