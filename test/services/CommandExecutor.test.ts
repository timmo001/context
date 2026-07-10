/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CommandExecutor,
  type CommandExitCodeOptions,
  type CommandRunOptions,
} from "../../src/services/CommandExecutor.js";

const helper = new URL("./fixtures/command-helper.ts", import.meta.url)
  .pathname;

function run(args: readonly string[], opts?: CommandRunOptions) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      return yield* executor.run(process.execPath, [helper, ...args], opts);
    }).pipe(Effect.provide(CommandExecutor.layer)),
  );
}

function runFailure(args: readonly string[], opts?: CommandRunOptions) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      return yield* executor
        .run(process.execPath, [helper, ...args], opts)
        .pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        );
    }).pipe(Effect.provide(CommandExecutor.layer)),
  );
}

function exitCodeFailure(
  args: readonly string[],
  opts?: CommandExitCodeOptions,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;
      return yield* executor
        .exitCode(process.execPath, [helper, ...args], opts)
        .pipe(
          Effect.match({
            onFailure: (error) => error,
            onSuccess: () => undefined,
          }),
        );
    }).pipe(Effect.provide(CommandExecutor.layer)),
  );
}

describe("CommandExecutor", () => {
  test("concurrently drains large stdout and stderr", async () => {
    const bytes = 2 * 1024 * 1024;
    const stdout = await run(["dual", String(bytes)], {
      timeoutMs: 5_000,
      maxOutputBytes: bytes * 2,
    });

    expect(stdout.length).toBe(bytes);
    expect(stdout.startsWith("oooo")).toBe(true);
  });

  test("retains stdout and stderr on non-zero exit", async () => {
    const error = await runFailure(["nonzero"]);

    expect(error).toBeInstanceOf(Error);
    expect(error?.reason).toBe("exit");
    expect(error?.exitCode).toBe(7);
    expect(error?.stdout).toBe("useful stdout\n");
    expect(error?.stderr).toBe("failure stderr\n");
  });

  test("terminates commands after their timeout", async () => {
    const error = await runFailure(["sleep"], { timeoutMs: 100 });

    expect(error?.reason).toBe("timeout");
  });

  test("terminates commands when their effect is cancelled", async () => {
    const marker = join(tmpdir(), `context-command-${crypto.randomUUID()}`);
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* CommandExecutor;
          return yield* executor
            .run(process.execPath, [helper, "delayed-file", marker])
            .pipe(
              Effect.timeout(50),
              Effect.match({
                onFailure: () => undefined,
                onSuccess: () => undefined,
              }),
            );
        }).pipe(Effect.provide(CommandExecutor.layer)),
      );
      await Bun.sleep(400);

      expect(await Bun.file(marker).exists()).toBe(false);
    } finally {
      await rm(marker, { force: true });
    }
  });

  test("terminates commands at the aggregate output cap", async () => {
    const maxOutputBytes = 64 * 1024;
    const error = await runFailure(["stdout", String(1024 * 1024)], {
      maxOutputBytes,
    });

    expect(error?.reason).toBe("output_limit");
    expect(error?.stdout.length).toBe(maxOutputBytes);
  });

  test("bounds exit-code-only commands", async () => {
    const error = await exitCodeFailure(["sleep"], { timeoutMs: 100 });

    expect(error?.reason).toBe("timeout");
  });
});
