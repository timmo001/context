import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detectStack } from "../../src/stack/context/detect.js";
import type { StackContextOptions } from "../../src/stack/context/model.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "context-stack-"));
  roots.push(root);
  const result = Bun.spawnSync(["git", "init", "--quiet"], {
    cwd: root,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return root;
}

function write(root: string, path: string, content = ""): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function detect(
  root: string,
  overrides: Partial<Omit<StackContextOptions, "root">> = {},
) {
  return detectStack({
    root,
    maxDepth: overrides.maxDepth ?? 12,
    maxFiles: overrides.maxFiles ?? 200_000,
    topLocations: overrides.topLocations ?? 4,
  });
}

describe("stack detection reliability", () => {
  test("uses prototype-safe catalogue and package lookups", () => {
    const root = repository();
    write(root, "constructor");
    write(root, "toString");
    write(
      root,
      "package.json",
      JSON.stringify({
        packageManager: "toString@1.0.0",
        dependencies: {
          constructor: "1",
          effect: "1",
          toString: "1",
        },
      }),
    );

    const result = detect(root);
    expect(result.languages).toEqual([
      { name: "JSON", files: 1, locations: ["."], confidence: "heuristic" },
    ]);
    expect(result.frameworks.map(({ name }) => name)).toEqual(["Effect"]);
    expect(result.tooling).toEqual([]);
  });

  test("ignores segment-matched directories before depth and file caps", () => {
    const root = repository();
    write(root, "node_modules/deep/ignored.ts");
    write(root, "target");

    const result = detect(root, { maxDepth: 1, maxFiles: 1 });
    expect(result.scannedFiles).toBe(1);
    expect(result.languages).toEqual([]);
    expect(result.truncations).toEqual([]);
  });

  test("reports exact maxFiles and maxDepth truncation counts", () => {
    const root = repository();
    write(root, "a.ts");
    write(root, "b.ts");
    write(root, "one/two/deep.py");

    const result = detect(root, { maxDepth: 1, maxFiles: 1 });
    expect(result.scannedFiles).toBe(1);
    expect(result.truncations).toContainEqual({
      reason: "maxDepth",
      limit: 1,
      observed: 2,
      omitted: 1,
    });
    expect(result.truncations).toContainEqual({
      reason: "maxFiles",
      limit: 1,
      observed: 2,
    });
  });

  test("matches GitHub workflow path segments rather than substrings", () => {
    const root = repository();
    write(root, ".github/workflows/root.yml");
    write(root, "packages/app/.github/workflows/nested.yaml");
    write(root, "x.github/workflows/not-a-workflow.yml");
    write(root, ".github/workflows-old/not-a-workflow.yml");

    const workflows = detect(root).ecosystems.find(
      ({ name }) => name === "github-actions",
    );
    expect(workflows?.manifests).toEqual([
      ".github/workflows/root.yml",
      "packages/app/.github/workflows/nested.yaml",
    ]);
  });

  test("rejects manifest and source symlinks", () => {
    const root = repository();
    const outside = mkdtempSync(join(tmpdir(), "context-stack-outside-"));
    roots.push(outside);
    writeFileSync(
      join(outside, "package.json"),
      JSON.stringify({ dependencies: { effect: "1" } }),
    );
    writeFileSync(join(outside, "source.ts"), "export {};\n");
    symlinkSync(join(outside, "package.json"), join(root, "package.json"));
    symlinkSync(join(outside, "source.ts"), join(root, "source.ts"));

    const result = detect(root);
    expect(result.scannedFiles).toBe(0);
    expect(result.ecosystems).toEqual([]);
    expect(result.frameworks).toEqual([]);
    expect(result.languages).toEqual([]);
  });

  test("bounds oversized manifests and keeps a warning", () => {
    const root = repository();
    write(root, "package.json", `{"padding":"${"x".repeat(1_048_576)}"}`);

    const result = detect(root);
    expect(result.truncations).toContainEqual({
      reason: "manifestReadBytes",
      limit: 1_048_576,
      observed: 1_048_590,
      omitted: 14,
      subject: "package.json",
    });
    expect(result.warnings).toEqual([
      "Skipped package.json; it exceeds the manifest read limit.",
    ]);
  });

  test("caps manifest and evidence collection with structured reasons", () => {
    const root = repository();
    for (let index = 0; index < 130; index += 1) {
      write(
        root,
        `packages/${String(index).padStart(3, "0")}/package.json`,
        JSON.stringify({ packageManager: `bun@1.3.${index}` }),
      );
    }

    const result = detect(root);
    const npm = result.ecosystems.find(({ name }) => name === "npm");
    expect(npm?.manifests).toHaveLength(128);
    expect(result.truncations).toContainEqual({
      reason: "manifestCollection",
      limit: 128,
      observed: 130,
      omitted: 2,
      subject: "npm",
    });
    expect(result.truncations).toContainEqual({
      reason: "toolingEvidenceCollection",
      limit: 64,
      observed: 128,
      omitted: 64,
      subject: "Bun",
    });
  });

  test("uses parsed declared dependencies as authoritative signals", () => {
    const root = repository();
    write(
      root,
      "go.mod",
      `module example.test/project
// github.com/gin-gonic/gin
require github.com/spf13/cobra v1.9.1
`,
    );
    write(
      root,
      "Cargo.toml",
      `[dependencies]
tokio = "1"
# axum = "0.8"
`,
    );
    write(
      root,
      "requirements-dev.txt",
      `# django and black are only comments
PyTest>=8
RUFF==0.12
`,
    );

    const result = detect(root);
    expect(result.frameworks).toEqual([
      {
        name: "Cobra",
        via: "go dep: github.com/spf13/cobra",
        confidence: "authoritative",
      },
      {
        name: "pytest",
        via: "python dep: pytest",
        confidence: "authoritative",
      },
      { name: "Tokio", via: "cargo dep: tokio", confidence: "authoritative" },
    ]);
    expect(result.tooling.map(({ name }) => name)).toEqual([
      "Cargo",
      "Go modules",
      "pytest",
      "Ruff",
    ]);
  });

  test("caches parse failures and deduplicates warnings", () => {
    const root = repository();
    write(root, "package.json", "{");

    const result = detect(root);
    expect(result.warnings).toEqual(["Could not parse package.json."]);
  });
});
