import {
  cliStyler,
  detectStack,
  plainStyler,
  renderStackContextJson,
  renderStackContextText,
  STACK_CONTEXT_DEFAULTS,
  stackContextJsonPayload,
  type StackContextJson,
  type StackContextOptions,
  type StackContextServices,
  type Styler,
} from "@timmo001/effect-context";
import { Effect } from "effect";
import { resolve } from "node:path";
import { writeText } from "../../lib/rows.js";

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
): Effect.Effect<string, never, StackContextServices> {
  return detectStack(options).pipe(
    Effect.map((stack) => renderStackContextText(stack, styler)),
    Effect.withSpan("stackContext.text"),
  );
}

/** Build stack-context text plus the bounded JSON payload from one snapshot. */
export function stackContextResult(
  options: StackContextOptions,
): Effect.Effect<
  { readonly text: string; readonly structured: StackContextJson },
  never,
  StackContextServices
> {
  return detectStack(options).pipe(
    Effect.map((stack) => ({
      text: renderStackContextText(stack, plainStyler),
      structured: stackContextJsonPayload(stack),
    })),
    Effect.withSpan("stackContext.result"),
  );
}

/** Build stack-context JSON output. */
export function stackContextJson(
  options: StackContextOptions,
): Effect.Effect<string, never, StackContextServices> {
  return detectStack(options).pipe(
    Effect.map((stack) => `${renderStackContextJson(stack)}\n`),
    Effect.withSpan("stackContext.json"),
  );
}

/** CLI: write stack-context text output to stdout. */
export function stackContextRaw(
  options: StackContextOptions,
  plain = false,
): Effect.Effect<void, never, StackContextServices> {
  return stackContextText(
    options,
    plain ? plainStyler : cliStyler(process.stdout),
  ).pipe(Effect.flatMap(writeText), Effect.withSpan("stackContext.raw"));
}

/** CLI: write stack-context JSON output to stdout. */
export function stackContextRawJson(
  options: StackContextOptions,
): Effect.Effect<void, never, StackContextServices> {
  return stackContextJson(options).pipe(
    Effect.flatMap(writeText),
    Effect.withSpan("stackContext.rawJson"),
  );
}
