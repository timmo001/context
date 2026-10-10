import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { collectPullRequest } from "../../src/git/context/pullRequest.js";
import {
  GIT_CONTEXT_DEFAULTS,
  PR_LIMITS,
} from "../../src/git/context/model.js";
import { GitHub, type GitHubService } from "../../src/git/services/GitHub.js";
import { failure, makeGitHub, success } from "./helpers/gh.js";

const fields =
  "--json=number,state,title,url,isDraft,mergeStateStatus,headRefName,baseRefName,reviewDecision,body,comments,labels,reviews";

const summaryResponse = {
  number: 42,
  state: "OPEN",
  title: "Improve context",
  url: "https://github.com/owner/repo/pull/42",
  isDraft: false,
  mergeStateStatus: "CLEAN",
  headRefName: "feature",
  baseRefName: "trunk",
  reviewDecision: "REVIEW_REQUIRED",
  body: "Description",
  comments: [],
  reviews: [],
  labels: [],
};

const check = (name: string, bucket: string) => ({
  name,
  state: bucket.toUpperCase(),
  bucket,
  link: "",
  workflow: null,
});

function collect(github: GitHubService, options = GIT_CONTEXT_DEFAULTS) {
  return Effect.runPromise(
    collectPullRequest(options).pipe(Effect.provideService(GitHub, github)),
  );
}

describe("collectPullRequest", () => {
  test("reads the pull request and its checks through typed operations", async () => {
    const commands: string[][] = [];

    const github = await makeGitHub((args) => {
      commands.push([...args]);

      return success(
        JSON.stringify(
          args[1] === "view" ? summaryResponse : [check("build", "pass")],
        ),
      );
    });

    const result = await collect(github, {
      ...GIT_CONTEXT_DEFAULTS,
      labels: true,
      comments: true,
      reviews: true,
      checks: true,
    });

    expect(commands).toEqual([
      ["pr", "view", fields],
      [
        "pr",
        "checks",
        "--repo=owner/repo",
        "--json=name,state,bucket,link,workflow",
        "--",
        "42",
      ],
    ]);
    expect(result.data?.checks).toBe("build\tpass");
  });

  test("silently handles branches without a pull request", async () => {
    const github = await makeGitHub(() =>
      failure("No pull requests found for branch FEATURE"),
    );

    expect(await collect(github)).toEqual({ data: null, warnings: [] });
  });

  test("reports unexpected GitHub failures", async () => {
    const github = await makeGitHub(() => failure("authentication failed"));

    expect(await collect(github)).toEqual({
      data: null,
      warnings: ["Unable to read PR details: authentication failed"],
    });
  });

  test("reports responses that do not match the pull request fields", async () => {
    for (const response of [
      "unexpected",
      { number: 42 },
      { ...summaryResponse, state: 123, labels: [false] },
    ]) {
      const github = await makeGitHub(() => success(JSON.stringify(response)));

      const result = await collect(github);

      expect(result.data).toBeNull();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toStartWith("Unable to read PR details:");
    }
  });

  test.each(["fail", "pending"])("keeps %s checks as data", async (bucket) => {
    const github = await makeGitHub((args) =>
      args[1] === "view"
        ? success(JSON.stringify(summaryResponse))
        : failure("check status", {
            stdout: JSON.stringify([check("build", bucket)]),
            exitCode: bucket === "pending" ? 8 : 1,
          }),
    );

    const result = await collect(github, {
      ...GIT_CONTEXT_DEFAULTS,
      checks: true,
    });

    expect(result.data?.checks).toBe(`build\t${bucket}`);
    expect(result.warnings).toEqual([]);
  });

  test("bounds every optional text section and aggregate list", async () => {
    const comments = Array.from(
      { length: PR_LIMITS.comments + 1 },
      (_, index) => ({
        author: { login: `commenter-${index}` },
        createdAt: "2026-01-01T00:00:00Z",
        body: "c".repeat(PR_LIMITS.itemBody + 1),
      }),
    );

    const reviews = Array.from(
      { length: PR_LIMITS.reviews + 1 },
      (_, index) => ({
        author: { login: `reviewer-${index}` },
        state: "COMMENTED",
        submittedAt: "2026-01-01T00:00:00Z",
        body: "r".repeat(PR_LIMITS.itemBody + 1),
      }),
    );

    const labels = Array.from({ length: PR_LIMITS.labels + 1 }, (_, index) => ({
      name: `label-${index}`,
    }));

    const checks = Array.from(
      { length: Math.ceil(PR_LIMITS.checks / 8) + 1 },
      (_, index) => check(`check-${index}`, "pass"),
    );

    const github = await makeGitHub((args) =>
      success(
        JSON.stringify(
          args[1] === "view"
            ? {
                ...summaryResponse,
                title: "t".repeat(PR_LIMITS.title + 1),
                url: `https://github.com/owner/repo/pull/42?${"u".repeat(PR_LIMITS.url)}`,
                body: "d".repeat(PR_LIMITS.body + 1),
                comments,
                reviews,
                labels,
              }
            : checks,
        ),
      ),
    );

    const result = await collect(github, {
      ...GIT_CONTEXT_DEFAULTS,
      labels: true,
      comments: true,
      reviews: true,
      checks: true,
    });

    expect(result.data).not.toBeNull();

    if (!result.data) throw new Error("Expected pull request data");
    expect(result.data.summary.title).toHaveLength(PR_LIMITS.title);
    expect(result.data.summary.url).toHaveLength(PR_LIMITS.url);
    expect(result.data.description).toHaveLength(PR_LIMITS.body);
    expect(result.data.labels).toHaveLength(PR_LIMITS.labels);
    expect(result.data.comments).toHaveLength(PR_LIMITS.comments);
    expect(result.data.reviews).toHaveLength(PR_LIMITS.reviews);
    expect(result.data.checks).toHaveLength(PR_LIMITS.checks);
    expect(
      result.data.comments?.reduce(
        (total, comment) => total + comment.body.length,
        0,
      ) ?? 0,
    ).toBeLessThanOrEqual(PR_LIMITS.collectionText);
    expect(
      result.data.reviews?.reduce(
        (total, review) => total + review.body.length,
        0,
      ) ?? 0,
    ).toBeLessThanOrEqual(PR_LIMITS.collectionText);
    expect(result.data.truncations.map((notice) => notice.path)).toEqual(
      expect.arrayContaining([
        "summary.title",
        "summary.url",
        "description",
        "labels",
        "comments",
        "reviews",
        "checks",
      ]),
    );
    expect(result.warnings.length).toBe(result.data.truncations.length);
  });
});
