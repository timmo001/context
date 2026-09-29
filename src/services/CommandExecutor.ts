import { Context, Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
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
export class CommandError extends Schema.TaggedError<CommandError>()(
  "CommandError",
  {
    command: Schema.String,
    exitCode: Schema.Finite,
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

const KILL_OPTIONS = {
  killSignal: "SIGTERM",
  forceKillAfter: 100,
} as const;

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
  cause: unknown,
): CommandError {
  return cause instanceof CommandError
    ? cause
    : new CommandError({
        command,
        exitCode: -1,
        reason,
        stdout: "",
        stderr: cause instanceof Error ? cause.message : String(cause),
      });
}

/** The spawner fails `exitCode` when the process dies from a signal. */
const SIGNALLED_EXIT_CODE = -1;

const exitCodeOf = (child: ChildProcessSpawner.ChildProcessHandle) =>
  Effect.orElseSucceed(child.exitCode, () => SIGNALLED_EXIT_CODE);

type Spawner = ChildProcessSpawner.ChildProcessSpawner["Service"];

const execute = Effect.fnUntraced(function* (
  spawner: Spawner,
  cmd: string,
  args: readonly string[],
  opts: CommandRunOptions | undefined,
) {
  const command = [cmd, ...args].join(" ");

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

  const exitCode = yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make(cmd, [...args], {
        cwd: opts?.cwd,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        ...KILL_OPTIONS,
      }),
    );

    const drain = (
      stream: Stream.Stream<Uint8Array, unknown>,
      output: CapturedOutput,
      streamLimit: number,
    ) =>
      stream.pipe(
        Stream.runForEachWhile((chunk) =>
          Effect.sync(() => {
            if (terminationReason !== undefined) return false;

            const accepted = Math.max(
              0,
              Math.min(
                chunk.byteLength,
                maxOutputBytes - aggregateBytes,
                streamLimit - output.bytes,
              ),
            );

            if (accepted > 0) {
              output.chunks.push(chunk.slice(0, accepted));
              output.bytes += accepted;
              aggregateBytes += accepted;
            }

            if (accepted < chunk.byteLength) {
              terminationReason = "output_limit";

              return false;
            }

            return true;
          }),
        ),
        Effect.tap(() =>
          terminationReason === undefined
            ? Effect.void
            : Effect.ignore(child.kill(KILL_OPTIONS)),
        ),
      );

    const finished = yield* Effect.all(
      [
        drain(child.stdout, stdout, maxStdoutBytes),
        drain(child.stderr, stderr, maxStderrBytes),
        exitCodeOf(child),
      ],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.timeoutOption(
        boundedOption(opts?.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
      ),
    );

    if (Option.isSome(finished)) return finished.value[2];

    terminationReason ??= "timeout";
    yield* Effect.ignore(child.kill(KILL_OPTIONS));

    return yield* exitCodeOf(child);
  }).pipe(
    Effect.scoped,
    Effect.mapError((cause) => commandError(command, "spawn", cause)),
  );

  const capturedStdout = decodeOutput(stdout);
  const capturedStderr = decodeOutput(stderr);

  if (terminationReason !== undefined) {
    return yield* new CommandError({
      command,
      exitCode,
      reason: terminationReason,
      stdout: capturedStdout,
      stderr: capturedStderr,
    });
  }

  if (exitCode !== 0) {
    return yield* new CommandError({
      command,
      exitCode,
      reason: "exit",
      stdout: capturedStdout,
      stderr: capturedStderr,
    });
  }

  return capturedStdout;
});

const executeExitCode = Effect.fnUntraced(function* (
  spawner: Spawner,
  cmd: string,
  args: readonly string[],
  opts: CommandExitCodeOptions | undefined,
) {
  const command = [cmd, ...args].join(" ");

  const outcome = yield* Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make(cmd, [...args], {
        cwd: opts?.cwd,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        ...KILL_OPTIONS,
      }),
    );

    const exited = yield* exitCodeOf(child).pipe(
      Effect.timeoutOption(
        boundedOption(opts?.timeoutMs, DEFAULT_COMMAND_TIMEOUT_MS),
      ),
    );

    if (Option.isSome(exited)) return { timedOut: false, code: exited.value };

    yield* Effect.ignore(child.kill(KILL_OPTIONS));

    return { timedOut: true, code: yield* exitCodeOf(child) };
  }).pipe(
    Effect.scoped,
    Effect.mapError((cause) => commandError(command, "spawn", cause)),
  );

  if (outcome.timedOut) {
    return yield* new CommandError({
      command,
      exitCode: outcome.code,
      reason: "timeout",
      stdout: "",
      stderr: "",
    });
  }

  return outcome.code;
});

/** Effect service for executing subprocess commands. */
export class CommandExecutor extends Context.Service<
  CommandExecutor,
  CommandExecutorService
>()("CommandExecutor") {
  static readonly layer = Layer.effect(
    CommandExecutor,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      return CommandExecutor.of({
        run: (cmd, args, opts) => execute(spawner, cmd, args, opts),
        exitCode: (cmd, args, opts) =>
          executeExitCode(spawner, cmd, args, opts),
      });
    }),
  );
}
