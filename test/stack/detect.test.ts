import { describe, expect, test } from "bun:test";
import { Effect, FileSystem, Path } from "effect";
import { detectStack } from "../../src/stack/context/detect.js";
import type { StackContextOptions } from "../../src/stack/context/model.js";
import { git, runScoped } from "../helpers/platform.js";

const repository = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "context-stack-" });
  yield* git(root, ["init", "--quiet"]);

  return root;
});

const write = Effect.fnUntraced(function* (
  root: string,
  file: string,
  content = "",
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolute = path.join(root, file);
  yield* fs.makeDirectory(path.dirname(absolute), { recursive: true });
  yield* fs.writeFileString(absolute, content);
});

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
  test("uses prototype-safe catalogue and package lookups", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        yield* write(root, "constructor");
        yield* write(root, "toString");
        yield* write(
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

        const result = yield* detect(root);
        expect(result.languages).toEqual([
          { name: "JSON", files: 1, locations: ["."], confidence: "heuristic" },
        ]);
        expect(result.frameworks.map(({ name }) => name)).toEqual(["Effect"]);
        expect(result.tooling).toEqual([]);
      }),
    ));

  test("ignores segment-matched directories before depth and file caps", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        yield* write(root, "node_modules/deep/ignored.ts");
        yield* write(root, "target");

        const result = yield* detect(root, { maxDepth: 1, maxFiles: 1 });
        expect(result.scannedFiles).toBe(1);
        expect(result.languages).toEqual([]);
        expect(result.truncations).toEqual([]);
      }),
    ));

  test("reports exact maxFiles and maxDepth truncation counts", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        yield* write(root, "a.ts");
        yield* write(root, "b.ts");
        yield* write(root, "one/two/deep.py");

        const result = yield* detect(root, { maxDepth: 1, maxFiles: 1 });
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
      }),
    ));

  test("matches GitHub workflow path segments rather than substrings", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        yield* write(root, ".github/workflows/root.yml");
        yield* write(root, "packages/app/.github/workflows/nested.yaml");
        yield* write(root, "x.github/workflows/not-a-workflow.yml");
        yield* write(root, ".github/workflows-old/not-a-workflow.yml");

        const workflows = (yield* detect(root)).ecosystems.find(
          ({ name }) => name === "github-actions",
        );

        expect(workflows?.manifests).toEqual([
          ".github/workflows/root.yml",
          "packages/app/.github/workflows/nested.yaml",
        ]);
      }),
    ));

  test("rejects manifest and source symlinks", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const outside = yield* fs.makeTempDirectoryScoped({
          prefix: "context-stack-outside-",
        });

        yield* write(
          outside,
          "package.json",
          JSON.stringify({ dependencies: { effect: "1" } }),
        );
        yield* write(outside, "source.ts", "export {};\n");
        yield* fs.symlink(
          path.join(outside, "package.json"),
          path.join(root, "package.json"),
        );
        yield* fs.symlink(
          path.join(outside, "source.ts"),
          path.join(root, "source.ts"),
        );

        const result = yield* detect(root);
        expect(result.scannedFiles).toBe(0);
        expect(result.ecosystems).toEqual([]);
        expect(result.frameworks).toEqual([]);
        expect(result.languages).toEqual([]);
      }),
    ));

  test("bounds oversized manifests and keeps a warning", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        yield* write(
          root,
          "package.json",
          `{"padding":"${"x".repeat(1_048_576)}"}`,
        );

        const result = yield* detect(root);
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
      }),
    ));

  test("caps manifest and evidence collection with structured reasons", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();

        for (let index = 0; index < 130; index += 1) {
          yield* write(
            root,
            `packages/${String(index).padStart(3, "0")}/package.json`,
            JSON.stringify({ packageManager: `bun@1.3.${index}` }),
          );
        }

        const result = yield* detect(root);
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
      }),
    ));

  test("uses parsed declared dependencies as authoritative signals", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        yield* write(
          root,
          "go.mod",
          `module example.test/project
// github.com/gin-gonic/gin
require github.com/spf13/cobra v1.9.1
`,
        );
        yield* write(
          root,
          "Cargo.toml",
          `[dependencies]
tokio = "1"
# axum = "0.8"
`,
        );
        yield* write(
          root,
          "requirements-dev.txt",
          `# django and black are only comments
PyTest>=8
RUFF==0.12
`,
        );

        const result = yield* detect(root);
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
          {
            name: "Tokio",
            via: "cargo dep: tokio",
            confidence: "authoritative",
          },
        ]);
        expect(result.tooling.map(({ name }) => name)).toEqual([
          "Cargo",
          "Go modules",
          "pytest",
          "Ruff",
        ]);
      }),
    ));

  test("caches parse failures and deduplicates warnings", () =>
    runScoped(
      Effect.gen(function* () {
        const root = yield* repository();
        yield* write(root, "package.json", "{");

        const result = yield* detect(root);
        expect(result.warnings).toEqual(["Could not parse package.json."]);
      }),
    ));
});
