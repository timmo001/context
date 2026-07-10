import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { McpServer } from "effect/unstable/ai";
import { GitHub } from "../../src/git/services/GitHub.js";
import { registerContextResources } from "../../src/mcp/resources/context.js";
import {
  gitContextToolOptions,
  registerContextTools,
} from "../../src/mcp/tools/context.js";
import {
  READONLY_HINTS,
  READONLY_OPEN_WORLD_HINTS,
} from "../../src/mcp/tools/register.js";
import { mcpTools } from "../../src/mcp/toolMetadata.js";
import { CommandExecutor } from "../../src/services/CommandExecutor.js";

const McpTestLayer = Layer.mergeAll(
  McpServer.McpServer.layer,
  CommandExecutor.layer,
  GitHub.layer.pipe(Layer.provide(CommandExecutor.layer)),
);

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

  test("registers the documented tools and resources", async () => {
    const registry = await Effect.runPromise(
      Effect.gen(function* () {
        yield* registerContextTools;
        yield* registerContextResources;
        return yield* McpServer.McpServer;
      }).pipe(Effect.provide(McpTestLayer)),
    );

    expect(registry.tools.map(({ tool }) => tool.name)).toEqual(
      mcpTools.map((tool) => tool.name),
    );
    for (const { tool } of registry.tools) {
      const documented = mcpTools.find((item) => item.name === tool.name);
      expect(documented).toBeDefined();
      expect(Object.keys(tool.inputSchema.properties ?? {})).toEqual(
        Object.keys(documented?.parameters ?? {}),
      );
    }
    expect(registry.resources.map(({ resource }) => resource.uri)).toEqual([
      "context://git",
      "context://stack",
    ]);
    expect(
      registry.resourceTemplates.map(({ template }) => template.uriTemplate),
    ).toEqual(["context://command/{name}"]);
  });
});
