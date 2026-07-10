import { describe, expect, test } from "bun:test";
import { gitContextToolOptions } from "../../src/mcp/tools/context.js";
import {
  READONLY_HINTS,
  READONLY_OPEN_WORLD_HINTS,
} from "../../src/mcp/tools/register.js";

describe("MCP context contracts", () => {
  test("normalises and rejects since values like the CLI", () => {
    expect(gitContextToolOptions({ since: "1970-01-01" }).since).toBe(
      "1970-01-01T00:00:00.000Z",
    );
    expect(() => gitContextToolOptions({ since: "not-a-date" })).toThrow(
      "Unknown --since value",
    );
  });

  test("marks Git context as open-world without weakening other tools", () => {
    expect(READONLY_OPEN_WORLD_HINTS).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(READONLY_HINTS.openWorldHint).toBe(false);
  });
});
