import { describe, expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  CommandError,
  CommandExecutor,
  type CommandExecutorService,
} from "../../src/services/CommandExecutor.js";
import { buildBranchContext } from "../../src/git/context/build.js";
import {
  GIT_CONTEXT_DEFAULTS,
  type BranchContextOptions,
} from "../../src/git/context/model.js";
import { GitHub, type GitHubService } from "../../src/git/services/GitHub.js";

const liveExecutor = Effect.runSync(
  Effect.gen(function* () {
    return yield* CommandExecutor;
  }).pipe(Effect.provide(CommandExecutor.layer)),
);

const unusedGitHub: GitHubService = {
  run: () => Effect.die("Unexpected GitHub command"),
  json: () => Effect.die("Unexpected GitHub command"),
};

function repoExecutor(
  repository: string,
  intercept?: CommandExecutorService["run"],
): CommandExecutorService {
  return {
    run: (cmd, args, opts) =>
      intercept?.(cmd, args, { ...opts, cwd: repository }) ??
      liveExecutor.run(cmd, args, { ...opts, cwd: repository }),
    exitCode: (cmd, args, opts) =>
      liveExecutor.exitCode(cmd, args, { ...opts, cwd: repository }),
  };
}

function collect(
  repository: string,
  executor: CommandExecutorService = repoExecutor(repository),
  github: GitHubService = unusedGitHub,
  overrides: Partial<BranchContextOptions> = {},
) {
  return Effect.runPromise(
    buildBranchContext({
      ...GIT_CONTEXT_DEFAULTS,
      description: false,
      status: true,
      ...overrides,
    }).pipe(
      Effect.provideService(CommandExecutor, executor),
      Effect.provideService(GitHub, github),
    ),
  );
}

function git(repository: string, args: readonly string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repository,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
}

async function withRepository(run: (repository: string) => Promise<void>) {
  const repository = await mkdtemp(join(tmpdir(), "context-git-"));
  try {
    git(repository, ["init", "-q", "--initial-branch=trunk"]);
    git(repository, ["config", "user.email", "context@example.invalid"]);
    git(repository, ["config", "user.name", "Context Test"]);
    await writeFile(join(repository, "old => name.txt"), "content\n");
    git(repository, ["add", "--all"]);
    git(repository, ["commit", "-qm", "initial"]);
    await run(repository);
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
}

describe("buildBranchContext", () => {
  test("models an unavailable remote HEAD without assuming main", async () => {
    await withRepository(async (repository) => {
      git(repository, [
        "remote",
        "add",
        "origin",
        "https://example.invalid/repo.git",
      ]);
      let githubCalled = false;
      const github: GitHubService = {
        run: () => {
          githubCalled = true;
          return Effect.succeed("");
        },
        json: () => {
          githubCalled = true;
          return Effect.succeed({});
        },
      };

      const context = await collect(
        repository,
        repoExecutor(repository),
        github,
      );

      expect(context.branchMetadata?.defaultRemote).toBe("origin");
      expect(context.branchMetadata?.defaultBranch).toBeNull();
      expect(context.branchMetadata?.baseRef).toBeNull();
      expect(context.branchMetadata?.onDefaultBranch).toBeNull();
      expect(context.workScope).toEqual({
        state: "unresolved",
        reason: "Default branch is unresolved.",
      });
      expect(context.warnings).toContain(
        "Skipped work-scope collection: default branch is unresolved.",
      );
      expect(context.warnings).toContain(
        "Skipped pull request collection: default branch is unresolved.",
      );
      expect(githubCalled).toBe(false);
    });
  });

  test("preserves unusual rename and untracked paths", async () => {
    await withRepository(async (repository) => {
      const renamed = "new\tline\nname => literal.txt";
      const modified = "modified\tline\nname => literal.txt";
      const untracked = "loose\tline\nname => literal.txt";
      await writeFile(join(repository, modified), "before\n");
      git(repository, ["add", "--all"]);
      git(repository, ["commit", "-qm", "add unusual path"]);
      await rename(
        join(repository, "old => name.txt"),
        join(repository, renamed),
      );
      await writeFile(join(repository, modified), "after\n");
      await writeFile(join(repository, untracked), "untracked\n");
      git(repository, ["add", "--all", ":!" + untracked]);

      const stagedContext = await collect(repository);
      expect(stagedContext.status?.staged).toHaveLength(2);
      const stagedRename = stagedContext.status?.staged.find(
        (file) => file.path === renamed,
      );
      expect(stagedRename).toMatchObject({
        status: "R100",
        originalPath: "old => name.txt",
        path: renamed,
        countsKnown: true,
        added: 0,
        deleted: 0,
      });
      expect(stagedRename?.raw).toBe(
        "R100\told => name.txt\tnew\\tline\\nname => literal.txt",
      );
      expect(
        stagedContext.status?.staged.find((file) => file.path === modified),
      ).toMatchObject({
        status: "M",
        path: modified,
        countsKnown: true,
        added: 1,
        deleted: 1,
      });
      expect(stagedContext.status?.untracked[0]?.path).toBe(untracked);
      expect(stagedContext.status?.short).toContain(
        "old => name.txt -> new\\tline\\nname => literal.txt",
      );

      git(repository, ["add", "--all"]);
      git(repository, ["commit", "-qm", "rename literal => path"]);
      const committedContext = await collect(repository);
      const committedRename = committedContext.commits?.records[0]?.files.find(
        (file) => file.path === renamed,
      );
      expect(committedRename).toMatchObject({
        status: "R100",
        originalPath: "old => name.txt",
        path: renamed,
        countsKnown: true,
      });
      expect(
        committedContext.commits?.records[0]?.files.find(
          (file) => file.path === modified,
        ),
      ).toMatchObject({ countsKnown: true, added: 1, deleted: 1 });
    });
  });

  test("fails when a requested status command fails", async () => {
    await withRepository(async (repository) => {
      const executor = repoExecutor(repository, (cmd, args, opts) => {
        if (cmd === "git" && args[0] === "status") {
          return Effect.fail(
            new CommandError({
              command: "git status",
              exitCode: 2,
              reason: "exit",
              stdout: "",
              stderr: "status failed",
            }),
          );
        }
        return liveExecutor.run(cmd, args, opts);
      });

      await expect(collect(repository, executor)).rejects.toThrow(
        "git status --short --branch -z failed with exit 2: status failed",
      );
    });
  });

  test("fails when a requested diff cannot be collected", async () => {
    await withRepository(async (repository) => {
      const executor = repoExecutor(repository, (cmd, args, opts) => {
        if (cmd === "git" && args.length === 1 && args[0] === "diff") {
          return Effect.fail(
            new CommandError({
              command: "git diff",
              exitCode: 2,
              reason: "exit",
              stdout: "",
              stderr: "diff failed",
            }),
          );
        }
        return liveExecutor.run(cmd, args, opts);
      });

      await expect(
        collect(repository, executor, unusedGitHub, {
          status: false,
          diff: true,
        }),
      ).rejects.toThrow("git diff failed with exit 2: diff failed");
    });
  });

  test("fails when mandatory commit data cannot be collected", async () => {
    await withRepository(async (repository) => {
      const executor = repoExecutor(repository, (cmd, args, opts) => {
        if (cmd === "git" && args[0] === "log") {
          return Effect.fail(
            new CommandError({
              command: "git log",
              exitCode: 2,
              reason: "exit",
              stdout: "",
              stderr: "log failed",
            }),
          );
        }
        return liveExecutor.run(cmd, args, opts);
      });

      await expect(collect(repository, executor)).rejects.toThrow(
        "git log --name-status -z",
      );
    });
  });
});
