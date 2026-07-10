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

function configureResolvedOrigin(repository: string) {
  git(repository, ["remote", "add", "origin", repository]);
  git(repository, ["update-ref", "refs/remotes/origin/trunk", "HEAD"]);
  git(repository, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/trunk",
  ]);
}

describe("buildBranchContext", () => {
  test("returns minimal context outside a git worktree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "context-not-git-"));
    try {
      expect(
        await collect(directory, repoExecutor(directory), unusedGitHub),
      ).toEqual({
        inRepo: false,
        pullRequest: null,
        warnings: [],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("models the resolved default branch and skips pull requests", async () => {
    await withRepository(async (repository) => {
      configureResolvedOrigin(repository);
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

      expect(context.branchMetadata).toMatchObject({
        currentBranch: "trunk",
        defaultRemote: "origin",
        defaultBranch: "trunk",
        baseRef: "origin/trunk",
        ahead: 0,
        behind: 0,
        onDefaultBranch: true,
      });
      expect(context.workScope).toEqual({
        state: "not-applicable",
        reason: "default-branch",
      });
      expect(context.pullRequest).toBeNull();
      expect(githubCalled).toBe(false);
    });
  });

  test("separates feature scope from upstream push status", async () => {
    await withRepository(async (repository) => {
      configureResolvedOrigin(repository);
      git(repository, ["switch", "-qc", "feature"]);
      await writeFile(join(repository, "pushed.txt"), "pushed\n");
      git(repository, ["add", "pushed.txt"]);
      git(repository, ["commit", "-qm", "pushed feature work"]);
      git(repository, ["update-ref", "refs/remotes/origin/feature", "HEAD"]);
      git(repository, ["branch", "--set-upstream-to=origin/feature"]);
      await writeFile(join(repository, "local.txt"), "local\n");
      git(repository, ["add", "local.txt"]);
      git(repository, ["commit", "-qm", "local feature work"]);

      const context = await collect(
        repository,
        repoExecutor(repository),
        unusedGitHub,
        { pullRequest: false },
      );

      expect(context.branchMetadata).toMatchObject({
        currentBranch: "feature",
        defaultBranch: "trunk",
        baseRef: "origin/feature",
        upstreamRef: "origin/feature",
        ahead: 1,
        behind: 0,
        onDefaultBranch: false,
      });
      expect(context.workScope).toMatchObject({
        state: "collected",
        baseRef: "origin/trunk",
      });
      expect(context.commits?.range).toEqual({
        args: ["origin/trunk..HEAD"],
        kind: "branch",
        sinceRef: "origin/trunk",
      });
      expect(context.commits?.records.map((record) => record.pushed)).toEqual([
        false,
        true,
      ]);
    });
  });

  test("sanitises credentials from remote details", async () => {
    await withRepository(async (repository) => {
      configureResolvedOrigin(repository);
      git(repository, [
        "remote",
        "set-url",
        "origin",
        "https://user:secret@example.invalid/repo.git",
      ]);
      git(repository, [
        "remote",
        "set-url",
        "--push",
        "origin",
        "https://push:secret@example.invalid/repo.git",
      ]);

      const context = await collect(
        repository,
        repoExecutor(repository),
        unusedGitHub,
        { remoteDetails: true },
      );

      expect(context.branchMetadata?.remoteDetails).toEqual([
        {
          name: "origin",
          fetchUrl: "https://example.invalid/repo.git",
          pushUrl: "https://example.invalid/repo.git",
        },
      ]);
    });
  });

  test("collects committed and working-tree changes in the branch diff", async () => {
    await withRepository(async (repository) => {
      configureResolvedOrigin(repository);
      git(repository, ["switch", "-qc", "feature"]);
      await writeFile(join(repository, "feature.txt"), "committed\n");
      git(repository, ["add", "feature.txt"]);
      git(repository, ["commit", "-qm", "feature work"]);
      await writeFile(join(repository, "feature.txt"), "committed\nworking\n");

      const context = await collect(
        repository,
        repoExecutor(repository),
        unusedGitHub,
        { branchDiff: true, pullRequest: false },
      );

      expect(context.diffs?.branch).toMatchObject({
        ref: "origin/trunk",
        mergeBase: expect.stringMatching(/^[0-9a-f]{7}$/),
      });
      expect(context.diffs?.branch?.diff).toContain("diff --git");
      expect(context.diffs?.branch?.diff).toContain("+committed");
      expect(context.diffs?.branch?.diff).toContain("+working");
    });
  });

  test("rejects branch diffs on the default branch", async () => {
    await withRepository(async (repository) => {
      configureResolvedOrigin(repository);

      await expect(
        collect(repository, repoExecutor(repository), unusedGitHub, {
          branchDiff: true,
        }),
      ).rejects.toThrow(
        "On the default branch (trunk); --branch-diff requires a feature branch.",
      );
    });
  });

  test("fails clearly when ahead and behind counts are malformed", async () => {
    await withRepository(async (repository) => {
      configureResolvedOrigin(repository);
      const executor = repoExecutor(repository, (cmd, args, opts) => {
        if (
          cmd === "git" &&
          args[0] === "rev-list" &&
          args[1] === "--left-right"
        ) {
          return Effect.succeed("bad data\n");
        }
        return liveExecutor.run(cmd, args, opts);
      });

      await expect(collect(repository, executor)).rejects.toThrow(
        "Unable to parse ahead/behind counts for 'origin/trunk'.",
      );
    });
  });

  test("models detached HEAD without attempting pull request collection", async () => {
    await withRepository(async (repository) => {
      configureResolvedOrigin(repository);
      git(repository, ["checkout", "-q", "--detach"]);
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

      expect(context.branchMetadata).toMatchObject({
        currentBranch: "",
        defaultBranch: "trunk",
        onDefaultBranch: false,
      });
      expect(context.pullRequest).toBeNull();
      expect(githubCalled).toBe(false);
    });
  });

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
