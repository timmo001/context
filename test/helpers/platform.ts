import { NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, type Path, type Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

type TestServices =
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner;

/** Run a test effect against the Node platform services in a fresh scope. */
export function runScoped<A, E>(
  effect: Effect.Effect<A, E, Scope.Scope | TestServices>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}

/** Run git in a directory and fail with its stderr on a non-zero exit. */
export const git = Effect.fnUntraced(function* (
  cwd: string,
  args: readonly string[],
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make("git", [...args], {
          cwd,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "pipe",
        }),
      );

      const [stderr, code] = yield* Effect.all(
        [
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode,
        ],
        { concurrency: "unbounded" },
      );

      if (code !== 0) return yield* Effect.fail(new Error(stderr));
    }),
  );
});

/** Promise form of {@link git} for async test bodies. */
export function gitAsync(cwd: string, args: readonly string[]): Promise<void> {
  return runScoped(git(cwd, args));
}

/** Create a temporary directory and return its path. */
export function makeTempDirectory(prefix: string): Promise<string> {
  return runScoped(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.makeTempDirectory({ prefix }),
    ),
  );
}

/** Write a text file. */
export function writeTextFile(path: string, content: string): Promise<void> {
  return runScoped(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.writeFileString(path, content),
    ),
  );
}

/** Rename a file or directory. */
export function renamePath(from: string, to: string): Promise<void> {
  return runScoped(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.rename(from, to)),
  );
}

/** Recursively remove a path, ignoring missing paths. */
export function removePath(path: string): Promise<void> {
  return runScoped(
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
      fs.remove(path, { recursive: true, force: true }),
    ),
  );
}

/** Whether a path exists. */
export function pathExists(path: string): Promise<boolean> {
  return runScoped(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(path)),
  );
}
