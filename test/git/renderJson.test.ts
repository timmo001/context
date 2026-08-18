import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import type { BranchContextData } from "../../src/git/context/model.js";
import { CHAR_LIMITS } from "../../src/git/context/model.js";
import { renderBranchContextJson } from "../../src/git/context/renderJson.js";

const truncationSchema = Schema.Struct({
  path: Schema.String,
  retained: Schema.Number,
});
const pullRequestSchema = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  comments: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  reviews: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  checks: Schema.optionalKey(Schema.String),
});
const payloadSchema = Schema.fromJsonString(
  Schema.Struct({
    inRepo: Schema.Boolean,
    commits: Schema.optionalKey(Schema.String),
    pullRequest: Schema.NullOr(pullRequestSchema),
    warnings: Schema.Array(Schema.String),
    truncations: Schema.Array(truncationSchema),
  }),
);
const decodePayload = Schema.decodeUnknownSync(payloadSchema);

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
      decodePayload(
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
    const withoutScope = decodePayload(
      renderBranchContextJson(context({ commits })),
    );
    const defaultScope = decodePayload(
      renderBranchContextJson(
        context({
          commits,
          workScope: { state: "not-applicable", reason: "default-branch" },
        }),
      ),
    );
    const collectedScope = decodePayload(
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
    );

    expect(withoutScope.commits).toBe("↑ abc1234 2h ago subject");
    expect(defaultScope.commits).toBe("↑ abc1234 2h ago subject");
    expect(collectedScope).not.toHaveProperty("commits");
  });

  test("preserves optional pull request omission and explicit empty values", () => {
    const omitted = decodePayload(
      renderBranchContextJson(
        context({
          pullRequest: { summary: pullRequestSummary, truncations: [] },
        }),
      ),
    );
    const empty = decodePayload(
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
    );

    expect(omitted.pullRequest).not.toBeNull();
    expect(empty.pullRequest).not.toBeNull();
    if (omitted.pullRequest === null || empty.pullRequest === null) return;

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
    const payload = decodePayload(rendered);

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

    const payload = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          branchMetadata: Schema.Struct({
            repositoryRoot: Schema.String,
            repositoryName: Schema.String,
          }),
          workScope: Schema.Struct({ branchDiffStat: Schema.String }),
          pullRequest: Schema.Struct({
            summary: Schema.Struct({ title: Schema.String }),
            description: Schema.String,
          }),
          warnings: Schema.Array(Schema.String),
        }),
      ),
    )(renderBranchContextJson(data));

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
    const payload = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({
          branchMetadata: Schema.Struct({
            remotes: Schema.Array(Schema.String),
            remoteDetails: Schema.Array(
              Schema.Struct({
                name: Schema.String,
                fetchUrl: Schema.String,
                pushUrl: Schema.String,
              }),
            ),
          }),
          truncations: Schema.Array(Schema.Struct({ path: Schema.String })),
        }),
      ),
    )(rendered);
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
