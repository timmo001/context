import { describe, expect, test } from "bun:test";
import type { BranchContextData } from "../../src/git/context/model.js";
import { CHAR_LIMITS } from "../../src/git/context/model.js";
import { renderBranchContextJson } from "../../src/git/context/renderJson.js";

describe("renderBranchContextJson", () => {
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
