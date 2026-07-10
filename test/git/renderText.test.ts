import { describe, expect, test } from "bun:test";
import type { BranchContextData } from "../../src/git/context/model.js";
import { renderBranchContextText } from "../../src/git/context/renderText.js";

describe("renderBranchContextText", () => {
  test("escapes controls from repository and pull request text", () => {
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
      pullRequest: {
        summary: {
          number: 1,
          state: "OPEN\u0007",
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

    const output = renderBranchContextText(data);

    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\u0007");
    expect(output).toContain("repo\\nname");
    expect(output).toContain("feature\\tname");
    expect(output).toContain("title\\x1b[2J");
    expect(output).toContain("first\\x1b[31m\n    second");
    expect(output).toContain("warning\\x07");
  });
});
