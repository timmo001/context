import { describe, expect, test } from "bun:test";
import type { BranchContextData } from "../../src/git/context/model.js";
import { renderBranchContextText } from "../../src/git/context/renderText.js";

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

describe("renderBranchContextText", () => {
  test("renders non-repository output exactly", () => {
    expect(
      renderBranchContextText({
        inRepo: false,
        pullRequest: null,
        warnings: [],
      }),
    ).toBe("Not a git repository.\n");
  });

  test("distinguishes known, binary, and unknown file counts", () => {
    const output = renderBranchContextText(
      context({
        status: {
          unstaged: [
            {
              raw: "M\tknown.txt",
              status: "M",
              path: "known.txt",
              countsKnown: true,
              added: 2,
              deleted: 1,
            },
            {
              raw: "M\tbinary.dat",
              status: "M",
              path: "binary.dat",
              countsKnown: true,
              added: null,
              deleted: null,
            },
            {
              raw: "M\tunknown.txt",
              status: "M",
              path: "unknown.txt",
              countsKnown: false,
              added: null,
              deleted: null,
            },
          ],
          staged: [],
          untracked: [],
          short: "",
        },
      }),
    );

    expect(output).toContain("M\tknown.txt  (+2 -1)");
    expect(output).toContain("M\tbinary.dat  (binary)");
    expect(output).toContain("M\tunknown.txt\n");
    expect(output).not.toContain("unknown.txt  (");
  });

  test("renders empty optional pull request sections explicitly", () => {
    const output = renderBranchContextText(
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
    );

    expect(output).toContain("Labels: (none)");
    expect(output).toContain("Description:\n    (none)");
    expect(output).toContain("Comments (0):\n    (none)");
    expect(output).toContain("Reviews (0):\n    (none)");
    expect(output).toContain("Checks:\n    (none)");
  });

  test("composes discoverability hints and suppresses them after diff collection", () => {
    const data = context({
      commits: {
        range: {
          args: ["origin/trunk..HEAD"],
          kind: "branch",
          sinceRef: "origin/trunk",
        },
        records: [],
      },
      pullRequest: {
        summary: pullRequestSummary,
        truncations: [],
      },
    });

    const output = renderBranchContextText(data);
    expect(output).toContain(
      "Run `context git --branch-diff` for the full diff vs origin/trunk, or --diff for the working-tree diff.",
    );
    expect(output).toContain(
      "Add --comments, --reviews, --labels, or --checks for more PR detail.",
    );
    expect(output).toContain(
      "Use --json for the branch-context plugin payload.",
    );

    const withDiffs = renderBranchContextText({ ...data, diffs: {} });
    expect(withDiffs).not.toContain("Run `context git");
    expect(withDiffs).not.toContain("Add --comments");
    expect(withDiffs).not.toContain("Use --json");
  });

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
