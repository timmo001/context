import { Context, Effect, Layer, Schema } from "effect";
import {
  DEFAULT_COMMAND_MAX_OUTPUT_BYTES,
  DEFAULT_COMMAND_TIMEOUT_MS,
} from "../lib/env.js";

export interface CommandRunOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxStdoutBytes?: number;
  readonly maxStderrBytes?: number;
}

export interface CommandExitCodeOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
}

/** Domain error for command execution failures. */
export class CommandError extends Schema.TaggedErrorClass<CommandError>()(
  "CommandError",
  {
    command: Schema.String,
    exitCode: Schema.Number,
    reason: Schema.Literals(["spawn", "exit", "timeout", "output_limit"]),
    stdout: Schema.String,
    stderr: Schema.String,
  },
) {}

/** Service interface for executing subprocess commands via Effect. */
export interface CommandExecutorService {
  /** Run a command and return stdout. Fails on non-zero exit. */
  readonly run: (
    cmd: string,
    args: readonly string[],
    opts?: CommandRunOptions,
  ) => Effect.Effect<string, CommandError>;
  /** Run a command and return its exit code without failing on non-zero. */
  readonly exitCode: (
    cmd: string,
    args: readonly string[],
    opts?: CommandExitCodeOptions,
  ) => Effect.Effect<number, CommandError>;
}

interface CapturedOutput {
  readonly chunks: Uint8Array[];
  bytes: number;
}

type TerminationReason = "timeout" | "output_limit";

const KILL_GRACE_MS = 100;

function boundedOption(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? fallback
    : Math.floor(value);
}

function decodeOutput(output: CapturedOutput): string {
  const bytes = new Uint8Array(output.bytes);
  let offset = 0;
  for (const chunk of output.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function commandError(
  command: string,
  reason: CommandError["reason"],
  error: unknown,
): CommandError {
  return error instanceof CommandError
    ? error
    : new CommandError({
        command,
        exitCode: -1,
        reason,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
}

async function execute(
  cmd: string,
  args: readonly string[],
  opts: CommandRunOptions | undefined,
  signal: AbortSignal,
): Promise<string> {
  const fullCmd = [cmd, ...args];
  const command = fullCmd.join(" ");
  const maxOutputBytes = boundedOption(
    opts?.maxOutputBytes,
    DEFAULT_COMMAND_MAX_OUTPUT_BYTES,
  );
  const maxStdoutBytes = boundedOption(opts?.maxStdoutBytes, maxOutputBytes);
  const maxStderrBytes = boundedOption(opts?.maxStderrBytes, maxOutputBytes);
  const stdout: CapturedOutput = { chunks: [], bytes: 0 };
  const stderr: CapturedOutput = { chunks: [], bytes: 0 };
  let aggregateBytes = 0;
  let terminationReason: TerminationReason | undefined;
  let hardKillTimer: ReturnType<typeof setTimeout> | undefined;

  const proc = Bun.spawn(fullCmd, {
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts?.cwd,
  });
  const stdoutReader = proc.stdout.getReader();
  const stderrReader = proc.stderr.getReader();

  const terminate = (reason?: TerminationReason) => {
    if (reason !== undefined && terminationReason === undefined) {
      terminationReason = reason;
    }
    void stdoutReader.cancel().catch(() => undefined);
    void stderrReader.cancel().catch(() => undefined);
    if (proc.exitCode !== null) return;
    try {
      proc.kill("SIGTERM");
    } catch {
      return;
    }
    hardKillTimer ??= setTimeout(() => {
      if (proc.exitCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // The process exited between the exit-code check and the signal.
        }
      }
    }, KILL_GRACE_MS);
  };

  const drain = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    output: CapturedOutput,
    streamLimit: number,
  ) => {
    try {
      while (terminationReason === undefined && !signal.aborted) {
        const result = await reader.read();
        if (result.done) return;
        const aggregateRemaining = maxOutputBytes - aggregateBytes;
        const streamRemaining = streamLimit - output.bytes;
        const accepted = Math.max(
          0,
          Math.min(
            result.value.byteLength,
            aggregateRemaining,
            streamRemaining,
          ),
        );
        if (accepted > 0) {
          output.chunks.push(result.value.slice(0, accepted));
          output.bytes += accepted;
          aggregateBytes += accepted;
        }
        if (accepted < result.value.byteLength) {
          terminate("output_limit");
          return;
        }
      }
    } catch (error) {
      if (terminationReason === undefined && !signal.aborted) throw error;
    } finally {
      reader.releaseLock();
    }
  };

  const abort = () => terminate();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeoutTimer = setTimeout(
    () => terminate("timeout"),
    boundedOption(opts?.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
  );

  let exitCode = -1;
  try {
    const [, , code] = await Promise.all([
      drain(stdoutReader, stdout, maxStdoutBytes),
      drain(stderrReader, stderr, maxStderrBytes),
      proc.exited,
    ]);
    exitCode = code;
  } catch (error) {
    terminate();
    await proc.exited.catch(() => -1);
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
    if (hardKillTimer !== undefined && proc.exitCode !== null) {
      clearTimeout(hardKillTimer);
    }
    signal.removeEventListener("abort", abort);
  }

  const capturedStdout = decodeOutput(stdout);
  const capturedStderr = decodeOutput(stderr);
  if (terminationReason !== undefined) {
    throw new CommandError({
      command,
      exitCode,
      reason: terminationReason,
      stdout: capturedStdout,
      stderr: capturedStderr,
    });
  }
  if (exitCode !== 0) {
    throw new CommandError({
      command,
      exitCode,
      reason: "exit",
      stdout: capturedStdout,
      stderr: capturedStderr,
    });
  }
  return capturedStdout;
}

async function executeExitCode(
  cmd: string,
  args: readonly string[],
  opts: CommandExitCodeOptions | undefined,
  signal: AbortSignal,
): Promise<number> {
  const proc = Bun.spawn([cmd, ...args], {
    stdout: "ignore",
    stderr: "ignore",
    cwd: opts?.cwd,
  });
  let timedOut = false;
  let hardKillTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    if (proc.exitCode !== null) return;
    try {
      proc.kill("SIGTERM");
    } catch {
      return;
    }
    hardKillTimer ??= setTimeout(() => {
      if (proc.exitCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // The process exited between the exit-code check and the signal.
        }
      }
    }, KILL_GRACE_MS);
  };
  const abort = () => terminate();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeoutTimer = setTimeout(
    () => {
      timedOut = true;
      terminate();
    },
    boundedOption(opts?.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
  );

  try {
    const exitCode = await proc.exited;
    if (timedOut) {
      throw new CommandError({
        command: [cmd, ...args].join(" "),
        exitCode,
        reason: "timeout",
        stdout: "",
        stderr: "",
      });
    }
    return exitCode;
  } catch (error) {
    terminate();
    throw error;
  } finally {
    clearTimeout(timeoutTimer);
    if (hardKillTimer !== undefined && proc.exitCode !== null) {
      clearTimeout(hardKillTimer);
    }
    signal.removeEventListener("abort", abort);
  }
}

/** Effect service for executing subprocess commands. */
export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorService
>()("CommandExecutor") {
  static readonly layer = Layer.succeed(CommandExecutor, {
    run: (cmd, args, opts) =>
      Effect.tryPromise({
        try: (signal) => execute(cmd, args, opts, signal),
        catch: (error) =>
          commandError([cmd, ...args].join(" "), "spawn", error),
      }),
    exitCode: (cmd, args, opts) =>
      Effect.tryPromise({
        try: (signal) => executeExitCode(cmd, args, opts, signal),
        catch: (error) =>
          commandError([cmd, ...args].join(" "), "spawn", error),
      }),
  });
}
