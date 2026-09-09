import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { collectPullRequest } from "../../src/git/context/pullRequest.js";
import {
  GIT_CONTEXT_DEFAULTS,
  PR_LIMITS,
} from "../../src/git/context/model.js";
import { GitHub, type GitHubService } from "../../src/git/services/GitHub.js";
import { failure, makeGitHub, success } from "./helpers/gh.js";

const summaryResponse = {
  number: 42,
  state: "OPEN",
  title: "Improve context",
  url: "https://example.invalid/pull/42",
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

function collect(github: GitHubService, options = GIT_CONTEXT_DEFAULTS) {
  return Effect.runPromise(
    collectPullRequest(options).pipe(Effect.provideService(GitHub, github)),
  );
}

describe("collectPullRequest", () => {
  test("requests exactly the enabled fields and check details", async () => {
    let jsonCall: { args: readonly string[]; options: unknown } | undefined;
    let runCall: { args: readonly string[]; options: unknown } | undefined;
    const github: GitHubService = {
      json: (args, options) => {
        jsonCall = { args, options };
        return Effect.succeed(summaryResponse);
      },
      run: (args, options) => {
        runCall = { args, options };
        return Effect.succeed("build\tpass\n");
      },
    };

    const result = await collect(github, {
      ...GIT_CONTEXT_DEFAULTS,
      labels: true,
      comments: true,
      reviews: true,
      checks: true,
    });

    expect(jsonCall).toEqual({
      args: [
        "pr",
        "view",
        "--json",
        "number,state,title,url,isDraft,mergeStateStatus,headRefName,baseRefName,reviewDecision,body,comments,labels,reviews",
      ],
      options: { checkRateLimit: false, retries: 0 },
    });
    expect(runCall).toEqual({
      args: ["pr", "checks", "42"],
      options: { checkRateLimit: false, retries: 0 },
    });
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

  test("distinguishes unexpected responses from missing required fields", async () => {
    const unexpected: GitHubService = {
      json: () => Effect.succeed("unexpected"),
      run: () => Effect.die("Unexpected checks command"),
    };
    const incomplete: GitHubService = {
      json: () => Effect.succeed({ number: 42 }),
      run: () => Effect.die("Unexpected checks command"),
    };

    expect(await collect(unexpected)).toEqual({
      data: null,
      warnings: ["Unable to read PR details: unexpected response."],
    });
    expect(await collect(incomplete)).toEqual({
      data: null,
      warnings: ["Unable to read PR details: required fields are missing."],
    });
  });

  test("tolerates malformed optional fields and collection entries", async () => {
    const github: GitHubService = {
      json: () =>
        Effect.succeed({
          number: 42,
          title: "Improve context",
          state: 123,
          isDraft: "no",
          comments: [
            null,
            { author: "unexpected", createdAt: false, body: "kept" },
          ],
          reviews: "unexpected",
          labels: [false, { name: "bug" }],
        }),
      run: () => Effect.die("Unexpected checks command"),
    };

    const result = await collect(github, {
      ...GIT_CONTEXT_DEFAULTS,
      labels: true,
      comments: true,
      reviews: true,
    });

    expect(result.data?.summary.state).toBe("");
    expect(result.data?.summary.isDraft).toBe(false);
    expect(result.data?.summary.commentCount).toBe(2);
    expect(result.data?.comments).toEqual([
      { author: "(unknown)", createdAt: "", body: "kept" },
    ]);
    expect(result.data?.reviews).toEqual([]);
    expect(result.data?.labels).toEqual(["bug"]);
  });

  test.each([
    { exitCode: 1, status: "fail" },
    { exitCode: 8, status: "pending" },
  ])(
    "retains useful check output on exit $exitCode",
    async ({ exitCode, status }) => {
      const commands: string[][] = [];
      const github = await makeGitHub((args) => {
        commands.push([...args]);
        return args[1] === "view"
          ? success(JSON.stringify(summaryResponse))
          : failure("check status", { stdout: `build\t${status}\n`, exitCode });
      });

      const result = await collect(github, {
        ...GIT_CONTEXT_DEFAULTS,
        checks: true,
      });

      expect(result.data?.checks).toBe(`build\t${status}`);
      expect(result.warnings).toEqual([]);
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(["pr", "checks", "42"]);
    },
  );

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
    const github: GitHubService = {
      json: () =>
        Effect.succeed({
          number: 42,
          state: "OPEN",
          title: "t".repeat(PR_LIMITS.title + 1),
          url: "u".repeat(PR_LIMITS.url + 1),
          isDraft: false,
          mergeStateStatus: "CLEAN",
          headRefName: "feature",
          baseRefName: "trunk",
          reviewDecision: "REVIEW_REQUIRED",
          body: "d".repeat(PR_LIMITS.body + 1),
          comments,
          reviews,
          labels,
        }),
      run: () => Effect.succeed("k".repeat(PR_LIMITS.checks + 1)),
    };

    const result = await Effect.runPromise(
      collectPullRequest({
        ...GIT_CONTEXT_DEFAULTS,
        labels: true,
        comments: true,
        reviews: true,
        checks: true,
      }).pipe(Effect.provideService(GitHub, github)),
    );

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
