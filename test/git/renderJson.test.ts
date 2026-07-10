import { describe, expect, test } from "bun:test";
import type { BranchContextData } from "../../src/git/context/model.js";
import { CHAR_LIMITS } from "../../src/git/context/model.js";
import { renderBranchContextJson } from "../../src/git/context/renderJson.js";

function context(
  overrides: Partial<BranchContextData> = {},
): BranchContextData {
  return {
    inRepo: true,
    pullRequest: null,
    warnings: [],
    ...overrides,
  };
}

const commit = {
  isoDate: "2026-01-01T00:00:00Z",
  shortHash: "abc1234",
  relativeTime: "2h ago",
  subject: "subject",
  pushed: false,
  files: [],
};

const pullRequestSummary = {
  number: 1,
  state: "OPEN",
  title: "Improve context",
  commentCount: 0,
  reviewDecision: "",
  url: "https://example.invalid/pull/1",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  headRefName: "feature",
  baseRefName: "trunk",
};

describe("renderBranchContextJson", () => {
  test("renders the exact non-repository schema", () => {
    expect(
      JSON.parse(
        renderBranchContextJson({
          inRepo: false,
          pullRequest: null,
          warnings: [],
        }),
      ),
    ).toEqual({
      inRepo: false,
      pullRequest: null,
      warnings: [],
      truncations: [],
    });
  });

  test("emits recent commits only when work scope was not collected", () => {
    const commits = {
      range: { args: ["-n", "10", "HEAD"], kind: "recent" as const },
      records: [commit],
    };
    const withoutScope = JSON.parse(
      renderBranchContextJson(context({ commits })),
    ) as Record<string, unknown>;
    const defaultScope = JSON.parse(
      renderBranchContextJson(
        context({
          commits,
          workScope: { state: "not-applicable", reason: "default-branch" },
        }),
      ),
    ) as Record<string, unknown>;
    const collectedScope = JSON.parse(
      renderBranchContextJson(
        context({
          commits,
          workScope: {
            state: "collected",
            baseRef: "origin/trunk",
            branchCommits: [],
            branchFiles: [],
            branchDiffStat: "",
          },
        }),
      ),
    ) as Record<string, unknown>;

    expect(withoutScope.commits).toBe("↑ abc1234 2h ago subject");
    expect(defaultScope.commits).toBe("↑ abc1234 2h ago subject");
    expect(collectedScope).not.toHaveProperty("commits");
  });

  test("preserves optional pull request omission and explicit empty values", () => {
    const omitted = JSON.parse(
      renderBranchContextJson(
        context({
          pullRequest: { summary: pullRequestSummary, truncations: [] },
        }),
      ),
    ) as { pullRequest: Record<string, unknown> };
    const empty = JSON.parse(
      renderBranchContextJson(
        context({
          pullRequest: {
            summary: pullRequestSummary,
            description: "",
            labels: [],
            comments: [],
            reviews: [],
            checks: "",
            truncations: [],
          },
        }),
      ),
    ) as { pullRequest: Record<string, unknown> };

    expect(omitted.pullRequest).not.toHaveProperty("description");
    expect(omitted.pullRequest).not.toHaveProperty("comments");
    expect(empty.pullRequest).toMatchObject({
      description: "",
      labels: [],
      comments: [],
      reviews: [],
      checks: "",
    });
  });

  test("falls back to a bounded payload when optional PR data is oversized", () => {
    const rendered = renderBranchContextJson(
      context({
        pullRequest: {
          summary: pullRequestSummary,
          comments: Array.from({ length: 100 }, (_, index) => ({
            author: `author-${index}`,
            createdAt: "2026-01-01T00:00:00Z",
            body: "x".repeat(20_000),
          })),
          truncations: [],
        },
      }),
    );
    const payload = JSON.parse(rendered) as {
      pullRequest: null;
      warnings: string[];
      truncations: Array<{ path: string; retained: number }>;
    };

    expect(rendered.length).toBeLessThanOrEqual(CHAR_LIMITS.jsonOutput);
    expect(payload.pullRequest).toBeNull();
    expect(payload.warnings).toContain(
      `Branch context payload exceeded ${CHAR_LIMITS.jsonOutput} characters; large sections were omitted.`,
    );
    expect(payload.truncations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "payload",
          retained: CHAR_LIMITS.jsonOutput,
        }),
      ]),
    );
  });

  test("does not restore controls after the payload is parsed", () => {
    const data: BranchContextData = {
      inRepo: true,
      branchMetadata: {
        repositoryRoot: "/tmp/repo\u001b[31m",
        repositoryName: "repo\nname",
        currentBranch: "feature\tname",
        headSha: "abc1234",
        defaultRemote: null,
        defaultBranch: null,
        baseRef: null,
        upstreamRef: "",
        ahead: null,
        behind: null,
        onDefaultBranch: null,
        remotes: [],
      },
      workScope: {
        state: "collected",
        baseRef: "origin/trunk",
        branchCommits: [],
        branchFiles: [],
        branchDiffStat: "file\u001b[2J | 1 +",
      },
      pullRequest: {
        summary: {
          number: 1,
          state: "OPEN",
          title: "title\u001b[2J",
          commentCount: 0,
          reviewDecision: "",
          url: "https://example.invalid/\u0007",
          isDraft: false,
          mergeStateStatus: "CLEAN",
          headRefName: "feature\tname",
          baseRefName: "trunk",
        },
        description: "first\u001b[31m\nsecond",
        truncations: [],
      },
      warnings: ["warning\u0007"],
    };

    const payload = JSON.parse(renderBranchContextJson(data)) as {
      branchMetadata: { repositoryRoot: string; repositoryName: string };
      workScope: { branchDiffStat: string };
      pullRequest: { summary: { title: string }; description: string };
      warnings: string[];
    };

    expect(payload.branchMetadata.repositoryRoot).toContain("\\x1b");
    expect(payload.branchMetadata.repositoryName).toBe("repo\\nname");
    expect(payload.workScope.branchDiffStat).toBe("file\\x1b[2J | 1 +");
    expect(payload.pullRequest.summary.title).toBe("title\\x1b[2J");
    expect(payload.pullRequest.description).toBe("first\\x1b[31m\nsecond");
    expect(payload.warnings).toEqual(["warning\\x07"]);
  });

  test("bounds aggregate output from repository metadata", () => {
    const data: BranchContextData = {
      inRepo: true,
      branchMetadata: {
        repositoryRoot: "r".repeat(2_000_000),
        repositoryName: "repo",
        currentBranch: "feature",
        headSha: "abc1234",
        defaultRemote: "origin",
        defaultBranch: "trunk",
        baseRef: "origin/trunk",
        upstreamRef: "origin/feature",
        ahead: 1,
        behind: 0,
        onDefaultBranch: false,
        remotes: Array.from(
          { length: 1_000 },
          (_, index) => `remote-${index}-${"x".repeat(5_000)}`,
        ),
        remoteDetails: Array.from({ length: 1_000 }, (_, index) => ({
          name: `remote-${index}`,
          fetchUrl: `https://example.invalid/${"f".repeat(20_000)}`,
          pushUrl: `https://example.invalid/${"p".repeat(20_000)}`,
        })),
      },
      pullRequest: null,
      warnings: [],
    };

    const rendered = renderBranchContextJson(data);
    const payload = JSON.parse(rendered) as {
      branchMetadata: { remotes: string[]; remoteDetails: unknown[] };
      truncations: Array<{ path: string }>;
    };
    expect(rendered.length).toBeLessThanOrEqual(CHAR_LIMITS.jsonOutput);
    expect(payload.branchMetadata.remotes).toHaveLength(50);
    expect(payload.branchMetadata.remoteDetails).toHaveLength(10);
    expect(payload.truncations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "branchMetadata.repositoryRoot" }),
        expect.objectContaining({ path: "branchMetadata.remotes" }),
        expect.objectContaining({ path: "branchMetadata.remoteDetails" }),
      ]),
    );
  });
});
