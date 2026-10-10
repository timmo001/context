import { describe, expect, test } from "bun:test";
import { Cli, PullRequest } from "@timmo001/effect-gh";
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

const isRateLimitRead = (args: readonly string[]) =>
  args.includes("rate_limit");

const rateLimitJson = (remaining: number, reset = 9_999_999_999) => {
  const resource = { limit: 5000, used: 5000 - remaining, remaining, reset };

  return `${JSON.stringify({ resources: { core: resource, graphql: resource, search: resource } })}\n`;
};

// A typed operation whose result is easy to assert on.
const probe = Cli.version();

const version = "gh version 2.81.0 (2026-10-01)\n";

describe("GitHub", () => {
  test("passes typed operation arguments and inherits SDK cwd and environment settings", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* ghFixture(
          () => ({ stdout: textStream('{"number":7}') }),
          {
            cwd: "/example/repository",
            env: { GH_HOST: "github.example", GH_TOKEN: "test-token" },
          },
        );

        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));
        expect(fixture.commands).toHaveLength(0);

        expect(
          yield* github.read(
            "gh pr view",
            PullRequest.get({
              selector: "literal; argument",
              fields: ["number"],
            }),
            { checkRateLimit: false },
          ),
        ).toEqual({ number: 7 });
        expect(fixture.commands[0]).toMatchObject({
          command: "gh",
          args: ["pr", "view", "--json=number", "--", "literal; argument"],
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

  test("keeps command output on failures for retry classification", async () => {
    const github = await makeGitHub(() =>
      failure("HTTP 503", { stdout: "response" }),
    );

    const error = await Effect.runPromise(
      github
        .read("gh --version", probe, { checkRateLimit: false, retries: 0 })
        .pipe(Effect.flip),
    );

    expect(error.stderr).toBe("HTTP 503");
    expect(error.stdout).toBe("response");
    expect(error.retryable).toBe(true);
  });

  test("stops at the stdout limit and closes the child scope", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const limit = DEFAULT_COMMAND_MAX_OUTPUT_BYTES;

        const fixture = yield* ghFixture(
          () => ({
            stdout: textStream("x".repeat(limit + 1)),
            exitCode: Effect.never,
          }),
          { maxOutputBytes: limit },
        );

        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));

        const error = yield* github
          .read("gh --version", probe, { checkRateLimit: false, retries: 0 })
          .pipe(Effect.flip);

        expect(error.reason).toBe("output_limit");
        expect(fixture.releases()).toBe(1);
      }),
    );
  });

  test("times out after the configured deadline", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const awaitingExit = yield* Deferred.make<void>();

        const fixture = yield* ghFixture(
          () => ({
            stdout: textStream("partial"),
            exitCode: Deferred.succeed(awaitingExit, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
          }),
          { timeout: DEFAULT_COMMAND_TIMEOUT_MS },
        );

        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));

        const fiber = yield* github
          .read("gh --version", probe, { checkRateLimit: false, retries: 0 })
          .pipe(Effect.flip, Effect.forkChild);

        yield* Deferred.await(awaitingExit);
        yield* TestClock.adjust(DEFAULT_COMMAND_TIMEOUT_MS);
        expect(yield* Fiber.join(fiber)).toMatchObject({
          reason: "timeout",
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
          .read("gh --version", probe, { checkRateLimit: false })
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
              // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- The platform factory requires a reason tag.
              _tag: "Unknown",
              module: "ChildProcess",
              method: "stdout",
              description: "pipe failed",
            }),
          ),
        }));

        const github = yield* GitHub.pipe(Effect.provide(fixture.layer));

        const error = yield* github
          .read("gh --version", probe, { checkRateLimit: false, retries: 0 })
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

      return success(isRateLimitRead(args) ? rateLimitJson(100) : version);
    });

    expect(await Effect.runPromise(github.read("first", probe))).toBe("2.81.0");
    expect(await Effect.runPromise(github.read("second", probe))).toBe(
      "2.81.0",
    );
    expect(commands).toEqual([
      ["api", "--method", "GET", "--", "rate_limit"],
      ["--version"],
      ["--version"],
    ]);
  });

  test("continues when the rate-limit check fails", async () => {
    const commands: string[][] = [];

    const github = await makeGitHub((args) => {
      commands.push([...args]);

      return isRateLimitRead(args)
        ? failure("gh is unavailable")
        : success(version);
    });

    expect(
      await Effect.runPromise(github.read("probe", probe, { retries: 0 })),
    ).toBe("2.81.0");
    expect(commands).toHaveLength(2);
  });

  test("rejects an exhausted rate limit before running the operation", async () => {
    const commands: string[][] = [];

    const github = await makeGitHub((args) => {
      commands.push([...args]);

      return success(rateLimitJson(0));
    });

    const error = await Effect.runPromise(
      github.read("gh --version", probe).pipe(Effect.flip),
    );

    expect(error).toHaveProperty("_tag", "GitHubError");
    expect(error).toMatchObject({
      command: "gh --version",
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

      return success(version);
    });

    await Effect.runPromise(
      github.read("probe", probe, { checkRateLimit: false }),
    );

    expect(commands).toEqual([["--version"]]);
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
        .read("gh --version", probe, { checkRateLimit: false, retries: 0 })
        .pipe(Effect.flip),
    );

    expect(error).toHaveProperty("_tag", "GitHubError");
    expect(error).toMatchObject({
      command: "gh --version",
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
        .read("probe", probe, { checkRateLimit: false, retries: 2 })
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
        : success(version);
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* Clock.Clock;
        const retryStarted = yield* Deferred.make<void>();

        const fiber = yield* github
          .read("probe", probe, { checkRateLimit: false, retries: 1 })
          .pipe(
            Effect.provideService(Clock.Clock, {
              currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
              currentTimeMillis: clock.currentTimeMillis,
              currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
              currentTimeNanos: clock.currentTimeNanos,
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
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

    expect(result).toBe("2.81.0");
    expect(attempts).toBe(2);
  });

  test("invalidates the cached snapshot after a rate-limited command", async () => {
    let rateLimitChecks = 0;
    let commands = 0;

    const github = await makeGitHub((args) => {
      if (isRateLimitRead(args)) {
        rateLimitChecks += 1;

        return success(rateLimitJson(100));
      }

      commands += 1;

      return commands === 1
        ? failure("API rate limit exceeded")
        : success(version);
    });

    await Effect.runPromise(
      github.read("probe", probe, { retries: 0 }).pipe(Effect.flip),
    );
    expect(
      await Effect.runPromise(github.read("probe", probe, { retries: 0 })),
    ).toBe("2.81.0");

    expect(rateLimitChecks).toBe(2);
    expect(commands).toBe(2);
  });

  test("re-checks the rate limit before a retry and stops when it is exhausted", async () => {
    let rateLimitChecks = 0;
    let commands = 0;

    const github = await makeGitHub((args) => {
      if (isRateLimitRead(args)) {
        rateLimitChecks += 1;

        return success(rateLimitJson(rateLimitChecks === 1 ? 100 : 0));
      }

      commands += 1;

      return failure("API rate limit exceeded");
    });

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* github
          .read("probe", probe, { retries: 1 })
          .pipe(Effect.flip, Effect.forkChild);

        yield* Effect.yieldNow.pipe(Effect.repeat({ times: 20 }));
        yield* TestClock.adjust("1 second");

        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(commands).toBe(1);
    expect(rateLimitChecks).toBe(2);
    expect(error).toMatchObject({ rateLimited: true, retryable: false });
    expect(error.stderr).toContain("rate limit exhausted");
  });

  test("reports an undecodable response as a non-retryable GitHub error", async () => {
    const github = await makeGitHub(() => success("not json"));

    const error = await Effect.runPromise(
      github
        .read("gh pr view", PullRequest.get({ fields: ["number"] }), {
          checkRateLimit: false,
        })
        .pipe(Effect.flip),
    );

    expect(error).toHaveProperty("_tag", "GitHubError");
    expect(error).toMatchObject({
      command: "gh pr view",
      reason: "exit",
      retryable: false,
      rateLimited: false,
    });
  });
});
