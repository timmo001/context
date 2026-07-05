import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { cliStyler, plainStyler, type Styler } from "../../lib/ansi.js";
import { GitHub } from "../services/GitHub.js";
import { buildBranchContext } from "../context/build.js";
import {
  GIT_CONTEXT_DEFAULTS,
  type BranchContextOptions,
} from "../context/model.js";
import { renderBranchContextJson } from "../context/renderJson.js";
import { renderBranchContextText } from "../context/renderText.js";
import { handleCommandError, writeText } from "../../lib/rows.js";

const handleContextError = handleCommandError("context git");

/** Resolve full git-context options from partial overrides on the defaults. */
export function gitContextOptions(
  overrides: Partial<BranchContextOptions>,
): BranchContextOptions {
  return { ...GIT_CONTEXT_DEFAULTS, ...overrides };
}

/** Build git-context text output for the given options. */
export function gitContextText(
  options: BranchContextOptions,
  styler: Styler = plainStyler,
): Effect.Effect<string, Error, CommandExecutor | GitHub> {
  return buildBranchContext(options).pipe(
    Effect.map((data) => renderBranchContextText(data, styler)),
    Effect.withSpan("gitContext.text"),
  );
}

/** Build git-context JSON output for the given options. */
export function gitContextJson(
  options: BranchContextOptions,
): Effect.Effect<string, Error, CommandExecutor | GitHub> {
  return buildBranchContext(options).pipe(
    Effect.map((data) => `${renderBranchContextJson(data)}\n`),
    Effect.withSpan("gitContext.json"),
  );
}

/** CLI: write the git-context text output to stdout. */
export function gitContextRaw(
  options: BranchContextOptions,
): Effect.Effect<void, never, CommandExecutor | GitHub> {
  return gitContextText(options, cliStyler(process.stdout)).pipe(
    Effect.flatMap(writeText),
    Effect.withSpan("gitContext.raw"),
    handleContextError,
  );
}

function warnInertJsonFlags(
  options: BranchContextOptions,
): Effect.Effect<void> {
  const inert: string[] = [];
  if (options.diff) inert.push("--diff");
  if (options.branchDiff) inert.push("--branch-diff");
  if (inert.length === 0) return Effect.void;
  return Effect.sync(() =>
    console.error(
      `[context git] ${inert.join(" and ")} ${inert.length === 1 ? "is" : "are"} text-only and ignored with --json.`,
    ),
  );
}

/** CLI: write the git-context JSON output to stdout. */
export function gitContextRawJson(
  options: BranchContextOptions,
): Effect.Effect<void, never, CommandExecutor | GitHub> {
  return warnInertJsonFlags(options).pipe(
    Effect.andThen(gitContextJson(options)),
    Effect.flatMap(writeText),
    Effect.withSpan("gitContext.rawJson"),
    handleContextError,
  );
}
