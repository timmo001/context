import { Effect } from "effect";
import {
  CommandExecutor,
  type CommandExecutorService,
} from "../services/CommandExecutor.js";
import { writeText } from "../lib/rows.js";

const OPENCODE_DEBUG_SECTIONS: readonly (readonly [
  string,
  readonly string[],
])[] = [
  ["opencode debug paths", ["debug", "paths"]],
  ["opencode debug config", ["debug", "config"]],
  ["opencode debug skill", ["debug", "skill"]],
  ["opencode debug info", ["debug", "info"]],
];

/** Run OpenCode debug commands and return their combined output. */
export function opencodeDebugText(
  executor: CommandExecutorService,
  agent: string | undefined,
): Effect.Effect<string> {
  return Effect.gen(function* () {
    const available = yield* executor.exitCode("which", ["opencode"]);
    if (available !== 0) return "OpenCode command not found in PATH\n";

    const sections = [...OPENCODE_DEBUG_SECTIONS];
    if (agent) {
      sections.push([
        `opencode debug agent ${agent}`,
        ["debug", "agent", agent],
      ]);
    }

    const rendered: string[] = [];
    for (const [label, args] of sections) {
      const body = yield* executor.run("opencode", args).pipe(
        Effect.map((output) => output.trim()),
        Effect.catch((error) =>
          Effect.succeed(
            `[error] exit ${error.exitCode}${
              error.stderr.trim() ? `: ${error.stderr.trim()}` : ""
            }`,
          ),
        ),
      );
      rendered.push(`## ${label}\n\n${body || "(no output)"}`);
    }
    return `${rendered.join("\n\n")}\n`;
  });
}

/** CLI: write OpenCode debug output to stdout. */
export function opencodeDebugRaw(agent: string | undefined) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const text = yield* opencodeDebugText(executor, agent);
    yield* writeText(text);
  });
}
