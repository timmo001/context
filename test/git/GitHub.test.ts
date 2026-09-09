import { describe, expect, test } from "bun:test";
import {
  Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  PlatformError,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { GitHub } from "../../src/git/services/GitHub.js";
import {
  DEFAULT_COMMAND_MAX_OUTPUT_BYTES,
  DEFAULT_COMMAND_TIMEOUT_MS,
} from "../../src/lib/env.js";
import {
  failure,
  ghFixture,
  makeGitHub,
  success,
  textStream,
} from "./helpers/gh.js";

describe("GitHub", () => {
  test("passes literal arguments and inherits SDK cwd and environment settings", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* ghFixture(() => ({ stdout: textStream("ok") }), {
          cwd: "/example/repository",
          env: { GH_HOST: "github.example", GH_TOKEN: "test-token" },
        });
        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));
        expect(fixture.commands).toHaveLength(0);
        yield* github.run(["pr", "view", "literal; argument"], {
          checkRateLimit: false,
        });
        expect(fixture.commands[0]).toMatchObject({
          command: "gh",
          args: ["pr", "view", "literal; argument"],
          options: {
            cwd: "/example/repository",
            extendEnv: true,
            shell: false,
            stdin: "ignore",
            env: {
              GH_HOST: "github.example",
              GH_TOKEN: "test-token",
              GH_PROMPT_DISABLED: "1",
            },
          },
        });
        expect(fixture.releases()).toBe(1);
      }),
    );
  });

  test("retains stderr beyond the SDK error bound for retry classification", async () => {
    const stderr = `HTTP 503\n${"x".repeat(70_000)}`;
    const github = await makeGitHub(() =>
      failure(stderr, { stdout: "response" }),
    );
    const error = await Effect.runPromise(
      github
        .run(["api", "user"], {
          checkRateLimit: false,
          retries: 0,
        })
        .pipe(Effect.flip),
    );
    expect(error.stderr).toBe(stderr);
    expect(error.stdout).toBe("response");
    expect(error.retryable).toBe(true);
  });

  test.each(["stdout", "stderr", "combined"])(
    "bounds %s output and closes the child scope",
    async (channel) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const limit = DEFAULT_COMMAND_MAX_OUTPUT_BYTES;
          const fixture = yield* ghFixture(() => ({
            stdout: textStream(
              channel === "stderr"
                ? ""
                : "x".repeat(
                    channel === "combined" ? Math.floor(limit / 2) : limit + 1,
                  ),
            ),
            stderr: textStream(
              channel === "stdout"
                ? ""
                : "y".repeat(
                    channel === "combined"
                      ? limit - Math.floor(limit / 2) + 1
                      : limit + 1,
                  ),
            ),
            exitCode: Effect.never,
          }));
          const github = yield* GitHub.pipe(Effect.provide(fixture.layer));
          const error = yield* github
            .run(["pr", "view"], { checkRateLimit: false, retries: 0 })
            .pipe(Effect.flip);
          expect(error.reason).toBe("output_limit");
          expect(
            Buffer.byteLength(error.stdout) + Buffer.byteLength(error.stderr),
          ).toBe(limit);
          expect(fixture.releases()).toBe(1);
        }),
      );
    },
  );

  test("decodes UTF-8 across pipe chunks", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* ghFixture(() => ({
          stdout: Stream.fromIterable([
            new Uint8Array([0xc3]),
            new Uint8Array([0xa9]),
          ]),
        }));
        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));
        expect(
          yield* github.run(["pr", "view"], { checkRateLimit: false }),
        ).toBe("é");
      }),
    );
  });

  test("times out after the configured deadline and retains partial output", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const awaitingExit = yield* Deferred.make<void>();
        const fixture = yield* ghFixture(() => ({
          stdout: textStream("partial"),
          stderr: textStream("diagnostic"),
          exitCode: Deferred.succeed(awaitingExit, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
        }));
        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));
        const fiber = yield* github
          .run(["pr", "view"], { checkRateLimit: false, retries: 0 })
          .pipe(Effect.flip, Effect.forkChild);
        yield* Deferred.await(awaitingExit);
        yield* TestClock.adjust(DEFAULT_COMMAND_TIMEOUT_MS);
        expect(yield* Fiber.join(fiber)).toMatchObject({
          reason: "timeout",
          stdout: "partial",
          stderr: "diagnostic",
          exitCode: -1,
        });
        expect(fixture.releases()).toBe(1);
      }).pipe(Effect.provide(TestClock.layer())),
    );
  });

  test("preserves interruption without retrying and closes the child scope", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* ghFixture(() => ({
          stdout: Stream.never,
          exitCode: Effect.never,
        }));
        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));
        const fiber = yield* github
          .run(["pr", "view"], { checkRateLimit: false })
          .pipe(Effect.forkChild);
        yield* Deferred.await(fixture.spawned);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
        ).toBe(true);
        expect(fixture.commands).toHaveLength(1);
        expect(fixture.releases()).toBe(1);
      }),
    );
  });

  test("maps platform pipe failures to domain errors", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* ghFixture(() => ({
          stdout: Stream.fail(
            PlatformError.systemError({
              _tag: "Unknown",
              module: "ChildProcess",
              method: "stdout",
              description: "pipe failed",
            }),
          ),
        }));
        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));
        const error = yield* github
          .run(["pr", "view"], { checkRateLimit: false, retries: 0 })
          .pipe(Effect.flip);
        expect(error).toMatchObject({
          reason: "spawn",
          exitCode: -1,
          retryable: false,
        });
        expect(error.stderr).toContain("pipe failed");
        expect(fixture.releases()).toBe(1);
      }),
    );
  });

  test("checks and caches the REST API rate limit", async () => {
    const commands: string[][] = [];
    const github = await makeGitHub((args) => {
      commands.push([...args]);
      return success(
        args[0] === "api" && args[1] === "rate_limit"
          ? "100\t9999999999\n"
          : "ok\n",
      );
    });

    expect(await Effect.runPromise(github.run(["pr", "view"]))).toBe("ok\n");
    expect(await Effect.runPromise(github.run(["pr", "checks"]))).toBe("ok\n");
    expect(commands).toEqual([
      [
        "api",
        "rate_limit",
        "--jq",
        ".resources.core | [.remaining, .reset] | @tsv",
      ],
      ["pr", "view"],
      ["pr", "checks"],
    ]);
  });

  test("continues when the rate-limit check fails", async () => {
    const commands: string[][] = [];
    const github = await makeGitHub((args) => {
      commands.push([...args]);
      return args[0] === "api" && args[1] === "rate_limit"
        ? failure("gh is unavailable")
        : success("result");
    });

    expect(
      await Effect.runPromise(github.run(["pr", "view"], { retries: 0 })),
    ).toBe("result");
    expect(commands).toHaveLength(2);
  });

  test("rejects an exhausted rate limit before running the command", async () => {
    const commands: string[][] = [];
    const github = await makeGitHub((args) => {
      commands.push([...args]);
      return success("0\t9999999999\n");
    });

    const error = await Effect.runPromise(
      github.run(["pr", "view"]).pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      _tag: "GitHubError",
      command: "gh pr view",
      exitCode: 1,
      reason: "exit",
      stdout: "",
      retryable: false,
      rateLimited: true,
    });
    expect(error.stderr).toContain(
      "GitHub REST API rate limit exhausted; resets at",
    );
    expect(commands).toHaveLength(1);
  });

  test("can bypass rate-limit checks", async () => {
    const commands: string[][] = [];
    const github = await makeGitHub((args) => {
      commands.push([...args]);
      return success("result");
    });

    await Effect.runPromise(
      github.run(["pr", "view"], { checkRateLimit: false }),
    );

    expect(commands).toEqual([["pr", "view"]]);
  });

  test("classifies rate-limit and transient command failures", async () => {
    const github = await makeGitHub(() =>
      failure("HTTP 503: secondary rate limit", {
        stdout: "response body",
        exitCode: 7,
      }),
    );

    const error = await Effect.runPromise(
      github
        .run(["pr", "view"], {
          checkRateLimit: false,
          retries: 0,
        })
        .pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      _tag: "GitHubError",
      command: "gh pr view",
      exitCode: 7,
      reason: "exit",
      stdout: "response body",
      stderr: "HTTP 503: secondary rate limit",
      retryable: true,
      rateLimited: true,
    });
  });

  test("does not retry permanent command failures", async () => {
    let attempts = 0;
    const github = await makeGitHub(() => {
      attempts += 1;
      return failure("authentication failed");
    });

    const error = await Effect.runPromise(
      github
        .run(["pr", "view"], { checkRateLimit: false, retries: 2 })
        .pipe(Effect.flip),
    );

    expect(attempts).toBe(1);
    expect(error).toMatchObject({
      retryable: false,
      rateLimited: false,
      stderr: "authentication failed",
    });
  });

  test("retries transient command failures", async () => {
    let attempts = 0;
    const github = await makeGitHub(() => {
      attempts += 1;
      return attempts === 1
        ? failure("HTTP 503 temporarily unavailable")
        : success("result");
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const retryStarted = yield* Deferred.make<void>();
        const fiber = yield* github
          .run(["pr", "view"], { checkRateLimit: false, retries: 1 })
          .pipe(
            Effect.provideService(Clock.Clock, {
              ...clock,
              sleep: (duration) =>
                Duration.toMillis(duration) === 1000
                  ? Deferred.succeed(retryStarted, undefined).pipe(
                      Effect.andThen(clock.sleep(duration)),
                    )
                  : clock.sleep(duration),
            }),
            Effect.forkChild,
          );
        yield* Deferred.await(retryStarted);
        yield* TestClock.adjust("1 second");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(result).toBe("result");
    expect(attempts).toBe(2);
  });

  test("invalidates the cached snapshot after a rate-limited command", async () => {
    let rateLimitChecks = 0;
    let commands = 0;
    const github = await makeGitHub((args) => {
      if (args[0] === "api" && args[1] === "rate_limit") {
        rateLimitChecks += 1;
        return success("100\t9999999999\n");
      }
      commands += 1;
      return commands === 1
        ? failure("API rate limit exceeded")
        : success("result");
    });

    await Effect.runPromise(
      github.run(["pr", "view"], { retries: 0 }).pipe(Effect.flip),
    );
    expect(
      await Effect.runPromise(github.run(["pr", "view"], { retries: 0 })),
    ).toBe("result");

    expect(rateLimitChecks).toBe(2);
    expect(commands).toBe(2);
  });

  test("reports invalid JSON as a non-retryable GitHub error", async () => {
    const github = await makeGitHub(() => success("not json"));

    const error = await Effect.runPromise(
      github.json(["pr", "view"], { checkRateLimit: false }).pipe(Effect.flip),
    );

    expect(error).toMatchObject({
      _tag: "GitHubError",
      command: "gh pr view",
      reason: "exit",
      stdout: "not json",
      retryable: false,
      rateLimited: false,
    });
    expect(error.stderr).toContain("JSON");
  });
});
