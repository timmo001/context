import { describe, expect, test } from "bun:test";
import type { StackContextData } from "../../src/stack/context/model.js";
import { STACK_LIMITS } from "../../src/stack/context/model.js";
import { renderStackContextJson } from "../../src/stack/context/renderJson.js";
import { renderStackContextText } from "../../src/stack/context/renderText.js";

function stack(overrides: Partial<StackContextData> = {}): StackContextData {
  return {
    root: "/tmp/repo",
    name: "repo",
    scannedFiles: 1,
    truncations: [],
    languages: [],
    ecosystems: [],
    tooling: [],
    frameworks: [],
    warnings: [],
    ...overrides,
  };
}

describe("bounded renderers", () => {
  test("JSON exposes output list caps without the 0.1 boolean", () => {
    const manifests = Array.from(
      { length: 15 },
      (_, index) => `p/${index}.json`,
    );
    const payload = JSON.parse(
      renderStackContextJson(
        stack({
          ecosystems: [{ name: "npm", manifests, confidence: "authoritative" }],
        }),
      ),
    ) as Record<string, unknown>;

    expect("truncated" in payload).toBe(false);
    expect(payload.truncations).toContainEqual({
      reason: "ecosystemManifestOutput",
      limit: 12,
      observed: 15,
      omitted: 3,
      subject: "npm",
    });
    expect(
      (payload.ecosystems as Array<{ manifests: string[] }>)[0]?.manifests,
    ).toHaveLength(12);
  });

  test("bounds JSON values and total output", () => {
    const payload = renderStackContextJson(
      stack({
        root: `/${"r".repeat(20_000)}`,
        warnings: Array.from({ length: 50 }, () => "w".repeat(20_000)),
      }),
    );
    const parsed = JSON.parse(payload) as {
      root: string;
      truncations: Array<{ reason: string }>;
    };
    expect(new TextEncoder().encode(payload).byteLength).toBeLessThanOrEqual(
      STACK_LIMITS.jsonOutputBytes,
    );
    expect(
      new TextEncoder().encode(parsed.root).byteLength,
    ).toBeLessThanOrEqual(STACK_LIMITS.outputValueBytes);
    expect(
      parsed.truncations.some(({ reason }) => reason === "outputValueBytes"),
    ).toBe(true);
    expect(parsed.truncations.some(({ reason }) => reason === "warnings")).toBe(
      true,
    );
  });

  test("text escapes repository-controlled controls and reports output caps", () => {
    const text = renderStackContextText(
      stack({
        root: "/tmp/repo\u001b[31m\nforged",
        ecosystems: [
          {
            name: "npm",
            manifests: Array.from(
              { length: 8 },
              (_, index) => `path/${index}\u001b[2J.json`,
            ),
            confidence: "authoritative",
          },
        ],
      }),
    );

    expect(text).not.toContain("\u001b");
    expect(text).toContain("\\x1b");
    expect(text).toContain("\\n");
    expect(text).toContain(
      "ecosystemManifestOutput: limit=6 observed=8 omitted=2 subject=npm",
    );
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
      STACK_LIMITS.textOutputBytes,
    );
  });
});
