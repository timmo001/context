import {
  layer as ghLayer,
  type GhOptions,
  type GhOutput,
} from "@timmo001/effect-gh";
import { Deferred, Effect, Layer, Sink, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { GitHub } from "../../../src/git/services/GitHub.js";

export const textStream = (text: string) =>
  Stream.succeed(new TextEncoder().encode(text));

export const ghFixture = Effect.fn("test.ghFixture")(function* (
  respond: (
    args: readonly string[],
  ) => Partial<ChildProcessSpawner.ChildProcessHandle>,
  options?: GhOptions,
) {
  const spawned = yield* Deferred.make<void>();
  const commands: ChildProcess.StandardCommand[] = [];
  let releases = 0;
  const spawn: ChildProcessSpawner.ChildProcessSpawner["Service"]["spawn"] = (
    command,
  ) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        if (command._tag !== "StandardCommand")
          throw new Error("Unexpected pipeline");
        commands.push(command);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
          ...respond(command.args),
        });
      }).pipe(Effect.tap(() => Deferred.succeed(spawned, undefined))),
      () =>
        Effect.sync(() => {
          releases++;
        }),
    );
  return {
    commands,
    spawned,
    releases: () => releases,
    layer: GitHub.layer.pipe(
      Layer.provide(ghLayer(options)),
      Layer.provide(
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(spawn),
        ),
      ),
    ),
  };
});

export const success = (stdout: string): GhOutput => ({
  stdout,
  stderr: "",
  exitCode: 0,
});

export const failure = (
  stderr: string,
  overrides: Partial<GhOutput> = {},
): GhOutput => ({
  stdout: "",
  stderr,
  exitCode: 1,
  ...overrides,
});

export async function makeGitHub(run: (args: readonly string[]) => GhOutput) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const fixture = yield* ghFixture((args) => {
        const output = run(args);
        return {
          stdout: textStream(output.stdout),
          stderr: textStream(output.stderr),
          exitCode: Effect.succeed(
            ChildProcessSpawner.ExitCode(output.exitCode),
          ),
        };
      });
      return yield* GitHub.pipe(Effect.provide(fixture.layer));
    }),
  );
}
