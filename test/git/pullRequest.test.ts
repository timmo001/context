import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { collectPullRequest } from "../../src/git/context/pullRequest.js";
import {
  GIT_CONTEXT_DEFAULTS,
  PR_LIMITS,
} from "../../src/git/context/model.js";
import { GitHub, type GitHubService } from "../../src/git/services/GitHub.js";

describe("collectPullRequest", () => {
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

    expect(result.data?.summary.title).toHaveLength(PR_LIMITS.title);
    expect(result.data?.summary.url).toHaveLength(PR_LIMITS.url);
    expect(result.data?.description).toHaveLength(PR_LIMITS.body);
    expect(result.data?.labels).toHaveLength(PR_LIMITS.labels);
    expect(result.data?.comments).toHaveLength(PR_LIMITS.comments);
    expect(result.data?.reviews).toHaveLength(PR_LIMITS.reviews);
    expect(result.data?.checks).toHaveLength(PR_LIMITS.checks);
    expect(
      result.data?.comments.reduce(
        (total, comment) => total + comment.body.length,
        0,
      ),
    ).toBeLessThanOrEqual(PR_LIMITS.collectionText);
    expect(
      result.data?.reviews.reduce(
        (total, review) => total + review.body.length,
        0,
      ),
    ).toBeLessThanOrEqual(PR_LIMITS.collectionText);
    expect(result.data?.truncations.map((notice) => notice.path)).toEqual(
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
    expect(result.warnings.length).toBe(result.data?.truncations.length);
  });
});
