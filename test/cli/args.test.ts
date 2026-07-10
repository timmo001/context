import { describe, expect, test } from "bun:test";
import {
  optionValue,
  parseCliArgs,
  parseSince,
  UsageError,
} from "../../src/cli/args.js";
import { gitCliInvocation } from "../../src/cli/git-options.js";

function usageError(args: readonly string[]): string {
  try {
    parseCliArgs(args);
  } catch (error) {
    expect(error).toBeInstanceOf(UsageError);
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected ${JSON.stringify(args)} to fail`);
}

describe("parseCliArgs", () => {
  test.each([
    [["unknown"], "context: unknown command 'unknown'"],
    [["--unknown"], "context: unknown option '--unknown'"],
    [["git", "--unknown"], "context git: unknown option '--unknown'"],
    [["git", "value"], "context git: unexpected argument 'value'"],
    [["stack", "one", "two"], "context stack: unexpected argument 'two'"],
    [["git", "--since"], "context git: option '--since' requires a value"],
    [
      ["git", "--since", "--json"],
      "context git: option '--since' requires a value",
    ],
    [["git", "--since="], "context git: option '--since' requires a value"],
    [
      ["git", "--since", "2d", "--since=3d"],
      "context git: option '--since' may only be specified once",
    ],
    [
      ["git", "--json", "--json"],
      "context git: option '--json' may only be specified once",
    ],
    [
      ["git", "--help", "-h"],
      "context git: option '--help' may only be specified once",
    ],
    [
      ["git", "--json=yes"],
      "context git: option '--json' does not take a value",
    ],
    [
      ["completions", "pwsh"],
      "context completions: invalid value 'pwsh' for <shell> (expected: bash, fish, zsh)",
    ],
    [
      ["help", "unknown"],
      "context help: invalid value 'unknown' for <command> (expected: git, stack, mcp, completions)",
    ],
  ] as const)("rejects %j", (args, expected) => {
    expect(usageError(args)).toBe(expected);
  });

  test("supports a hyphen-prefixed positional after --", () => {
    const parsed = parseCliArgs(["stack", "--", "-project"]);
    expect(parsed.positionals).toEqual(["-project"]);
    expect(parsed.help).toBeFalse();
  });

  test("normalises aliases and valued options", () => {
    const parsed = parseCliArgs(["git", "-h", "--since=0"]);
    expect(parsed.help).toBeTrue();
    expect(optionValue(parsed, "--since")).toBe("1970-01-01T00:00:00.000Z");
    expect(parsed.options.has("--help")).toBeTrue();
  });

  test("does not treat values after -- as help flags", () => {
    const parsed = parseCliArgs(["stack", "--", "--help"]);
    expect(parsed.positionals).toEqual(["--help"]);
    expect(parsed.help).toBeFalse();
  });
});

describe("parseSince", () => {
  test.each([
    ["0", "1970-01-01T00:00:00.000Z"],
    ["2024-02-29", "2024-02-29T00:00:00.000Z"],
    ["Thu, 01 Jan 1970 00:00:00 GMT", "1970-01-01T00:00:00.000Z"],
  ])("parses %s", (value, expected) => {
    expect(parseSince(value)).toBe(expected);
  });

  test.each([
    "",
    "not-a-date",
    "-1",
    "2023-02-29",
    "Thu, 30 Feb 2023 00:00:00 GMT",
    "999999999999999999999999",
  ])("rejects %s cleanly", (value) => {
    expect(() => parseSince(value)).toThrow("Unknown --since value");
  });
});

describe("gitCliInvocation", () => {
  test("warns for JSON diff flags without forwarding collection options", () => {
    const invocation = gitCliInvocation(
      parseCliArgs(["git", "--json", "--diff", "--branch-diff"]),
    );
    expect(invocation.json).toBeTrue();
    expect(invocation.inertJsonFlags).toEqual(["--diff", "--branch-diff"]);
    expect(invocation.options.diff).toBeFalse();
    expect(invocation.options.branchDiff).toBeFalse();
  });

  test("retains text diff collection options", () => {
    const invocation = gitCliInvocation(
      parseCliArgs(["git", "--diff", "--branch-diff"]),
    );
    expect(invocation.inertJsonFlags).toEqual([]);
    expect(invocation.options.diff).toBeTrue();
    expect(invocation.options.branchDiff).toBeTrue();
  });

  test("retains git command defaults", () => {
    expect(gitCliInvocation(parseCliArgs(["git"])).options).toEqual({
      diff: false,
      branchDiff: false,
      since: undefined,
      description: true,
      labels: false,
      comments: false,
      reviews: false,
      checks: false,
      pullRequest: true,
      branchMetadata: true,
      remoteDetails: false,
      status: true,
      workScope: true,
    });
  });
});
