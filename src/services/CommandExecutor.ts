import { Context, Effect, Layer, Schema } from "effect";

/** Domain error for command execution failures. */
export class CommandError extends Schema.TaggedErrorClass<CommandError>()(
  "CommandError",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    stderr: Schema.String,
  },
) {}

/** Service interface for executing subprocess commands via Effect. */
export interface CommandExecutorService {
  /** Run a command and return stdout. Fails on non-zero exit. */
  readonly run: (
    cmd: string,
    args: readonly string[],
    opts?: { readonly cwd?: string },
  ) => Effect.Effect<string, CommandError>;
  /** Run a command and return its exit code without failing on non-zero. */
  readonly exitCode: (
    cmd: string,
    args: readonly string[],
    opts?: { readonly cwd?: string },
  ) => Effect.Effect<number>;
}

/** Effect service for executing subprocess commands. */
export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorService
>()("CommandExecutor") {
  static readonly layer = Layer.succeed(CommandExecutor, {
    run: (cmd, args, opts) =>
      Effect.tryPromise({
        try: async (signal) => {
          const fullCmd = [cmd, ...args];
          const proc = Bun.spawn(fullCmd, {
            stdout: "pipe",
            stderr: "pipe",
            cwd: opts?.cwd,
          });
          if (signal.aborted) proc.kill();
          signal.addEventListener("abort", () => proc.kill(), { once: true });

          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          if (exitCode !== 0) {
            throw new CommandError({
              command: fullCmd.join(" "),
              exitCode,
              stderr: stderr.trim(),
            });
          }
          return stdout;
        },
        catch: (error) =>
          error instanceof CommandError
            ? error
            : new CommandError({
                command: [cmd, ...args].join(" "),
                exitCode: 1,
                stderr: error instanceof Error ? error.message : String(error),
              }),
      }),
    exitCode: (cmd, args, opts) =>
      Effect.promise(async () => {
        const proc = Bun.spawn([cmd, ...args], {
          stdout: "ignore",
          stderr: "ignore",
          cwd: opts?.cwd,
        });
        return await proc.exited;
      }),
  });
}
