import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  CommandError,
  CommandExecutor,
  type CommandExecutorService,
} from "../../src/services/CommandExecutor.js";
import { GitHub, type GitHubService } from "../../src/git/services/GitHub.js";

function commandError(stderr: string, overrides: Partial<CommandError> = {}) {
  return new CommandError({
    command: "gh pr view",
    exitCode: 1,
    reason: "exit",
    stdout: "",
    stderr,
    ...overrides,
  });
}

async function makeGitHub(
  run: CommandExecutorService["run"],
): Promise<GitHubService> {
  const executor: CommandExecutorService = {
    run,
    exitCode: () => Effect.die("Unexpected exit-code command"),
  };
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* GitHub;
    }).pipe(
      Effect.provide(GitHub.layer),
      Effect.provideService(CommandExecutor, executor),
    ),
  );
}

describe("GitHub", () => {
  test("checks and caches the REST API rate limit", async () => {
    const commands: string[][] = [];
    const github = await makeGitHub((_cmd, args) => {
      commands.push([...args]);
      return Effect.succeed(
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
    const github = await makeGitHub((_cmd, args) => {
      commands.push([...args]);
      return args[0] === "api" && args[1] === "rate_limit"
        ? Effect.fail(commandError("gh is unavailable"))
        : Effect.succeed("result");
    });

    expect(
      await Effect.runPromise(github.run(["pr", "view"], { retries: 0 })),
    ).toBe("result");
    expect(commands).toHaveLength(2);
  });

  test("rejects an exhausted rate limit before running the command", async () => {
    const commands: string[][] = [];
    const github = await makeGitHub((_cmd, args) => {
      commands.push([...args]);
      return Effect.succeed("0\t9999999999\n");
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
    const github = await makeGitHub((_cmd, args) => {
      commands.push([...args]);
      return Effect.succeed("result");
    });

    await Effect.runPromise(
      github.run(["pr", "view"], { checkRateLimit: false }),
    );

    expect(commands).toEqual([["pr", "view"]]);
  });

  test("classifies rate-limit and transient command failures", async () => {
    const github = await makeGitHub(() =>
      Effect.fail(
        commandError("HTTP 503: secondary rate limit", {
          stdout: "response body",
          exitCode: 7,
        }),
      ),
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
      return Effect.fail(commandError("authentication failed"));
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
        ? Effect.fail(commandError("HTTP 503 temporarily unavailable"))
        : Effect.succeed("result");
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* github
          .run(["pr", "view"], { checkRateLimit: false, retries: 1 })
          .pipe(Effect.forkChild);
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
    const github = await makeGitHub((_cmd, args) => {
      if (args[0] === "api" && args[1] === "rate_limit") {
        rateLimitChecks += 1;
        return Effect.succeed("100\t9999999999\n");
      }
      commands += 1;
      return commands === 1
        ? Effect.fail(commandError("API rate limit exceeded"))
        : Effect.succeed("result");
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
    const github = await makeGitHub(() => Effect.succeed("not json"));

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
