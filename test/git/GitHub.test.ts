import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
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
