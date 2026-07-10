/** Git-aware, bounded stack detection and manifest parsing. */
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { DEFAULT_COMMAND_TIMEOUT_MS } from "../../lib/env.js";
import {
  CONFIG_TOOLING,
  EXT_LANG,
  FILENAME_LANG,
  FRAMEWORK_INDEX,
  IGNORE_DIRS,
  LOCKFILE_TOOLING,
  MANIFEST_ECO,
  MANIFEST_TOOLING,
  NPM_TOOLING,
  PACKAGE_MANAGER_FIELD_TOOLING,
  PARSED_DEPENDENCY_ECOSYSTEMS,
  TEXT_TOOLING,
  type ToolingRule,
} from "./catalog.js";
import {
  parseCargoDependencies,
  parseGoModDependencies,
  parsePipfileDependencies,
  parsePyprojectDependencies,
  parseRequirementsDependencies,
  parseSetupPyDependencies,
} from "./manifestParsers.js";
import {
  STACK_COLLECTION_LIMITS,
  type EcosystemEntry,
  type FrameworkEntry,
  type LanguageEntry,
  type StackContextData,
  type StackContextOptions,
  type StackTruncation,
  type StackTruncationReason,
  type ToolingEntry,
  type ToolingKind,
} from "./model.js";

const GITHUB_ACTIONS_ECO = "github-actions";
const REQUIREMENTS_FILE = /^requirements.*\.txt$/i;

interface MutableTruncation {
  reason: StackTruncationReason;
  limit: number;
  observed?: number;
  omitted?: number;
  subject?: string;
}

interface MutableToolingEntry {
  readonly kinds: Set<ToolingKind>;
  readonly evidence: string[];
  omittedEvidence: number;
}

interface WalkAccumulator {
  readonly langFiles: Map<string, number>;
  readonly langDirs: Map<string, Map<string, number>>;
  readonly langLocationOverflow: Map<string, number>;
  readonly manifests: Map<string, string[]>;
  readonly manifestOverflow: Map<string, number>;
  readonly tooling: Map<string, MutableToolingEntry>;
  scannedFiles: number;
}

interface CollectionState {
  readonly warnings: string[];
  readonly warningSet: Set<string>;
  readonly truncations: MutableTruncation[];
  manifestBytesRead: number;
  omittedWarnings: number;
  omittedTruncations: number;
}

type GitFileList =
  | {
      readonly ok: true;
      readonly files: readonly string[];
      readonly outputTruncated: boolean;
      readonly observedBytes: number;
    }
  | { readonly ok: false; readonly warning: string };

interface PackageJsonData {
  readonly dependencyNames: readonly string[];
  readonly packageManager: string | null;
}

interface ManifestCacheEntry {
  text?: string;
  readAttempted: boolean;
  packageJson?: PackageJsonData;
  packageJsonAttempted: boolean;
  dependencies?: readonly string[];
  dependenciesAttempted: boolean;
}

function ownLookup<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function ownValue(
  record: Readonly<Record<string, unknown>>,
  key: string,
): unknown | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function topKeys(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function addWarning(state: CollectionState, warning: string): void {
  if (state.warningSet.has(warning)) return;
  state.warningSet.add(warning);
  if (state.warnings.length < STACK_COLLECTION_LIMITS.warnings) {
    state.warnings.push(warning);
  } else {
    state.omittedWarnings += 1;
  }
}

function addTruncation(
  state: CollectionState,
  truncation: StackTruncation,
): void {
  const existing = state.truncations.find(
    (entry) =>
      entry.reason === truncation.reason &&
      entry.limit === truncation.limit &&
      entry.subject === truncation.subject,
  );
  if (existing) {
    if (truncation.observed !== undefined) {
      existing.observed = Math.max(existing.observed ?? 0, truncation.observed);
    }
    if (truncation.omitted !== undefined) {
      existing.omitted = (existing.omitted ?? 0) + truncation.omitted;
    }
    return;
  }
  if (
    state.truncations.length <
    STACK_COLLECTION_LIMITS.truncationReasons - 1
  ) {
    state.truncations.push({ ...truncation });
  } else {
    state.omittedTruncations += 1;
  }
}

function finalTruncations(state: CollectionState): StackTruncation[] {
  if (state.omittedWarnings > 0) {
    addTruncation(state, {
      reason: "warnings",
      limit: STACK_COLLECTION_LIMITS.warnings,
      observed: state.warnings.length + state.omittedWarnings,
      omitted: state.omittedWarnings,
    });
  }
  if (state.omittedTruncations > 0) {
    state.truncations.push({
      reason: "truncationReasons",
      limit: STACK_COLLECTION_LIMITS.truncationReasons,
      observed: state.truncations.length + state.omittedTruncations,
      omitted: state.omittedTruncations,
    });
  }
  return state.truncations.map((entry) => ({ ...entry }));
}

function decode(stdout: Uint8Array): string {
  return new TextDecoder().decode(stdout).trim();
}

function gitFailure(result: Bun.SyncSubprocess): string {
  const stderr = result.stderr ? decode(result.stderr) : "";
  return stderr || `git exited ${result.exitCode}`;
}

function completeNullTerminatedPaths(stdout: Uint8Array): string[] {
  const text = new TextDecoder().decode(stdout);
  const lastTerminator = text.lastIndexOf("\0");
  if (lastTerminator < 0) return [];
  return text.slice(0, lastTerminator).split("\0").filter(Boolean);
}

function gitFiles(root: string): GitFileList {
  try {
    const inside = Bun.spawnSync(
      ["git", "rev-parse", "--is-inside-work-tree"],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        maxBuffer: 65_536,
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      },
    );
    if (inside.exitedDueToTimeout) {
      return {
        ok: false,
        warning: `Git worktree detection timed out after ${DEFAULT_COMMAND_TIMEOUT_MS}ms.`,
      };
    }
    if (inside.exitCode !== 0 || decode(inside.stdout) !== "true") {
      return {
        ok: false,
        warning: `No readable Git worktree at '${root}'; stack context is unavailable.`,
      };
    }

    const listed = Bun.spawnSync(
      [
        "git",
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--deduplicate",
        "--",
        ".",
      ],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
        maxBuffer: STACK_COLLECTION_LIMITS.gitFileListBytes,
        timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      },
    );
    if (listed.exitedDueToTimeout) {
      return {
        ok: false,
        warning: `Git file listing timed out after ${DEFAULT_COMMAND_TIMEOUT_MS}ms.`,
      };
    }
    if (listed.exitedDueToMaxBuffer) {
      return {
        ok: true,
        files: completeNullTerminatedPaths(listed.stdout),
        outputTruncated: true,
        observedBytes: Math.max(
          listed.stdout.byteLength,
          STACK_COLLECTION_LIMITS.gitFileListBytes + 1,
        ),
      };
    }
    if (listed.exitCode !== 0) {
      return {
        ok: false,
        warning: `Could not list Git files: ${gitFailure(listed)}.`,
      };
    }

    return {
      ok: true,
      files: completeNullTerminatedPaths(listed.stdout),
      outputTruncated: false,
      observedBytes: listed.stdout.byteLength,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      warning: `Could not run git for stack context: ${message}.`,
    };
  }
}

function locationOf(relPath: string): string {
  const parts = relPath.split("/");
  parts.pop();
  return parts.length === 0 ? "." : parts.slice(0, 2).join("/");
}

function pathSegments(rel: string): string[] {
  return rel.split("/").filter(Boolean);
}

function isIgnoredPath(segments: readonly string[]): boolean {
  return segments.slice(0, -1).some((segment) => IGNORE_DIRS.has(segment));
}

function withinDepth(segments: readonly string[], maxDepth: number): boolean {
  return segments.length - 1 <= maxDepth;
}

function isReadableRegularFile(root: string, rel: string): boolean {
  try {
    const stat = lstatSync(join(root, rel));
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isGithubWorkflow(
  segments: readonly string[],
  extension: string,
): boolean {
  if (extension !== ".yml" && extension !== ".yaml") return false;
  return segments.some(
    (segment, index) =>
      segment === ".github" && segments[index + 1] === "workflows",
  );
}

function recordManifest(acc: WalkAccumulator, eco: string, rel: string): void {
  const manifests = acc.manifests.get(eco) ?? [];
  if (manifests.length < STACK_COLLECTION_LIMITS.manifestsPerEcosystem) {
    manifests.push(rel);
    acc.manifests.set(eco, manifests);
  } else {
    bump(acc.manifestOverflow, eco);
  }
}

function recordTooling(
  acc: WalkAccumulator,
  rule: ToolingRule,
  evidence: string,
): void {
  const entry =
    acc.tooling.get(rule.name) ??
    ({
      kinds: new Set<ToolingKind>(),
      evidence: [],
      omittedEvidence: 0,
    } satisfies MutableToolingEntry);
  for (const kind of rule.kinds) entry.kinds.add(kind);
  if (entry.evidence.includes(evidence)) return;
  if (entry.evidence.length < STACK_COLLECTION_LIMITS.evidencePerTool) {
    entry.evidence.push(evidence);
  } else {
    entry.omittedEvidence += 1;
  }
  acc.tooling.set(rule.name, entry);
}

function censusFile(acc: WalkAccumulator, name: string, rel: string): void {
  const language =
    ownLookup(FILENAME_LANG, name) ??
    ownLookup(EXT_LANG, extname(name).toLowerCase());
  if (!language) return;
  bump(acc.langFiles, language);
  const dirs = acc.langDirs.get(language) ?? new Map<string, number>();
  const location = locationOf(rel);
  if (
    dirs.has(location) ||
    dirs.size < STACK_COLLECTION_LIMITS.locationsPerLanguage
  ) {
    bump(dirs, location);
    acc.langDirs.set(language, dirs);
  } else {
    bump(acc.langLocationOverflow, language);
  }
}

function classifyFile(acc: WalkAccumulator, name: string, rel: string): void {
  const eco =
    ownLookup(MANIFEST_ECO, name) ??
    (REQUIREMENTS_FILE.test(name) ? "python" : undefined);
  if (eco) recordManifest(acc, eco, rel);

  const manifestTool = ownLookup(MANIFEST_TOOLING, name);
  if (manifestTool) recordTooling(acc, manifestTool, `manifest: ${rel}`);
  const lockfileTool = ownLookup(LOCKFILE_TOOLING, name);
  if (lockfileTool) recordTooling(acc, lockfileTool, `lockfile: ${rel}`);
  const configTool =
    ownLookup(CONFIG_TOOLING, name) ?? ownLookup(CONFIG_TOOLING, rel);
  if (configTool) recordTooling(acc, configTool, `config: ${rel}`);

  const segments = pathSegments(rel);
  if (isGithubWorkflow(segments, extname(name).toLowerCase())) {
    recordManifest(acc, GITHUB_ACTIONS_ECO, rel);
  }
  censusFile(acc, name, rel);
}

function walk(
  root: string,
  options: StackContextOptions,
  files: readonly string[],
  state: CollectionState,
): WalkAccumulator {
  const acc: WalkAccumulator = {
    langFiles: new Map(),
    langDirs: new Map(),
    langLocationOverflow: new Map(),
    manifests: new Map(),
    manifestOverflow: new Map(),
    tooling: new Map(),
    scannedFiles: 0,
  };
  let depthOmitted = 0;
  let observedDepth = 0;
  const candidates: string[] = [];

  for (const rel of files) {
    const segments = pathSegments(rel);
    if (segments.length === 0 || isIgnoredPath(segments)) continue;
    if (!withinDepth(segments, options.maxDepth)) {
      depthOmitted += 1;
      observedDepth = Math.max(observedDepth, segments.length - 1);
      continue;
    }
    candidates.push(rel);
  }

  let fileCapObserved: number | undefined;
  for (const rel of candidates) {
    if (!isReadableRegularFile(root, rel)) continue;
    if (acc.scannedFiles >= options.maxFiles) {
      fileCapObserved = acc.scannedFiles + 1;
      break;
    }

    acc.scannedFiles += 1;
    classifyFile(acc, basename(rel), rel);
  }

  if (depthOmitted > 0) {
    addTruncation(state, {
      reason: "maxDepth",
      limit: options.maxDepth,
      observed: observedDepth,
      omitted: depthOmitted,
    });
  }
  if (fileCapObserved !== undefined) {
    addTruncation(state, {
      reason: "maxFiles",
      limit: options.maxFiles,
      observed: fileCapObserved,
    });
    addWarning(
      state,
      `Scan stopped at the ${options.maxFiles}-file cap; results are partial.`,
    );
  }
  for (const [eco, omitted] of acc.manifestOverflow) {
    addTruncation(state, {
      reason: "manifestCollection",
      limit: STACK_COLLECTION_LIMITS.manifestsPerEcosystem,
      observed: STACK_COLLECTION_LIMITS.manifestsPerEcosystem + omitted,
      omitted,
      subject: eco,
    });
  }
  for (const [language, omitted] of acc.langLocationOverflow) {
    addTruncation(state, {
      reason: "languageLocations",
      limit: STACK_COLLECTION_LIMITS.locationsPerLanguage,
      observed: STACK_COLLECTION_LIMITS.locationsPerLanguage + 1,
      subject: language,
    });
  }
  return acc;
}

function packageJsonData(text: string): PackageJsonData {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("package.json must contain an object");
  }
  const pkg = parsed as Record<string, unknown>;
  const names = new Set<string>();
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const block = ownValue(pkg, field);
    if (typeof block !== "object" || block === null || Array.isArray(block))
      continue;
    for (const key of Object.keys(block)) names.add(key);
  }
  const packageManager = ownValue(pkg, "packageManager");
  return {
    dependencyNames: [...names].sort(),
    packageManager: typeof packageManager === "string" ? packageManager : null,
  };
}

function packageManagerName(value: string): string {
  return value.split("@")[0] ?? value;
}

function cacheEntry(
  cache: Map<string, ManifestCacheEntry>,
  rel: string,
): ManifestCacheEntry {
  const entry =
    cache.get(rel) ??
    ({
      readAttempted: false,
      packageJsonAttempted: false,
      dependenciesAttempted: false,
    } satisfies ManifestCacheEntry);
  cache.set(rel, entry);
  return entry;
}

function readManifest(
  root: string,
  rel: string,
  cache: Map<string, ManifestCacheEntry>,
  state: CollectionState,
): string | undefined {
  const entry = cacheEntry(cache, rel);
  if (entry.readAttempted) return entry.text;
  entry.readAttempted = true;

  let descriptor: number | undefined;
  try {
    const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
    descriptor = openSync(join(root, rel), constants.O_RDONLY | noFollow);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new TypeError("not a regular file");

    const remaining =
      STACK_COLLECTION_LIMITS.manifestTotalBytes - state.manifestBytesRead;
    if (remaining <= 0) {
      addTruncation(state, {
        reason: "manifestTotalReadBytes",
        limit: STACK_COLLECTION_LIMITS.manifestTotalBytes,
        observed: state.manifestBytesRead + stat.size,
        omitted: stat.size,
        subject: rel,
      });
      addWarning(
        state,
        `Skipped ${rel}; the manifest read budget was exhausted.`,
      );
      return undefined;
    }
    const limit = Math.min(STACK_COLLECTION_LIMITS.manifestBytes, remaining);
    if (stat.size > limit) {
      const totalBudgetApplied =
        limit !== STACK_COLLECTION_LIMITS.manifestBytes;
      addTruncation(state, {
        reason: totalBudgetApplied
          ? "manifestTotalReadBytes"
          : "manifestReadBytes",
        limit: totalBudgetApplied
          ? STACK_COLLECTION_LIMITS.manifestTotalBytes
          : STACK_COLLECTION_LIMITS.manifestBytes,
        observed: totalBudgetApplied
          ? state.manifestBytesRead + stat.size
          : stat.size,
        omitted: stat.size - limit,
        subject: rel,
      });
      addWarning(
        state,
        `Skipped ${rel}; it exceeds the ${totalBudgetApplied ? "total manifest read budget" : "manifest read limit"}.`,
      );
      return undefined;
    }

    const bytes = Buffer.allocUnsafe(Math.min(limit + 1, stat.size + 1));
    const read = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (read > limit) {
      addTruncation(state, {
        reason: "manifestReadBytes",
        limit: STACK_COLLECTION_LIMITS.manifestBytes,
        observed: read,
        omitted: read - limit,
        subject: rel,
      });
      addWarning(
        state,
        `Skipped ${rel}; it grew beyond the manifest read limit.`,
      );
      return undefined;
    }
    state.manifestBytesRead += read;
    entry.text = new TextDecoder().decode(bytes.subarray(0, read));
    return entry.text;
  } catch {
    addWarning(state, `Could not read ${rel}.`);
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function parsedPackageJson(
  root: string,
  rel: string,
  cache: Map<string, ManifestCacheEntry>,
  state: CollectionState,
): PackageJsonData | undefined {
  const entry = cacheEntry(cache, rel);
  if (entry.packageJsonAttempted) return entry.packageJson;
  entry.packageJsonAttempted = true;
  const text = readManifest(root, rel, cache, state);
  if (text === undefined) return undefined;
  try {
    entry.packageJson = packageJsonData(text);
    return entry.packageJson;
  } catch {
    addWarning(state, `Could not parse ${rel}.`);
    return undefined;
  }
}

function manifestDependencies(
  root: string,
  eco: string,
  rel: string,
  cache: Map<string, ManifestCacheEntry>,
  state: CollectionState,
): readonly string[] {
  const entry = cacheEntry(cache, rel);
  if (entry.dependenciesAttempted) return entry.dependencies ?? [];
  entry.dependenciesAttempted = true;
  const text = readManifest(root, rel, cache, state);
  if (text === undefined) return [];

  try {
    if (eco === "go" && basename(rel) === "go.mod") {
      entry.dependencies = parseGoModDependencies(text);
    } else if (eco === "cargo" && basename(rel) === "Cargo.toml") {
      entry.dependencies = parseCargoDependencies(text);
    } else if (eco === "python") {
      const name = basename(rel);
      if (name === "pyproject.toml") {
        entry.dependencies = parsePyprojectDependencies(text);
      } else if (REQUIREMENTS_FILE.test(name)) {
        entry.dependencies = parseRequirementsDependencies(text);
      } else if (name === "Pipfile") {
        entry.dependencies = parsePipfileDependencies(text);
      } else if (name === "setup.py") {
        entry.dependencies = parseSetupPyDependencies(text);
      } else {
        entry.dependencies = [];
      }
    } else {
      entry.dependencies = [];
    }
    return entry.dependencies;
  } catch {
    addWarning(state, `Could not parse ${rel}.`);
    entry.dependencies = [];
    return entry.dependencies;
  }
}

function detectNpm(
  root: string,
  manifests: ReadonlyMap<string, string[]>,
  acc: WalkAccumulator,
  frameworks: Map<string, FrameworkEntry>,
  cache: Map<string, ManifestCacheEntry>,
  state: CollectionState,
): void {
  for (const rel of manifests.get("npm") ?? []) {
    const pkg = parsedPackageJson(root, rel, cache, state);
    if (!pkg) continue;
    if (pkg.packageManager) {
      const rule = ownLookup(
        PACKAGE_MANAGER_FIELD_TOOLING,
        packageManagerName(pkg.packageManager),
      );
      if (rule) {
        recordTooling(
          acc,
          rule,
          `packageManager: ${pkg.packageManager} (${rel})`,
        );
      }
    }
    for (const dependency of pkg.dependencyNames) {
      const tool = ownLookup(NPM_TOOLING, dependency);
      if (tool) recordTooling(acc, tool, `npm dep: ${dependency}`);
      const framework = FRAMEWORK_INDEX.get(`npm:${dependency}`);
      if (framework && !frameworks.has(framework.name)) {
        frameworks.set(framework.name, {
          name: framework.name,
          via: `npm dep: ${dependency}`,
          confidence: "authoritative",
        });
      }
    }
  }
}

function detectParsedDependencies(
  root: string,
  manifests: ReadonlyMap<string, string[]>,
  acc: WalkAccumulator,
  frameworks: Map<string, FrameworkEntry>,
  cache: Map<string, ManifestCacheEntry>,
  state: CollectionState,
): void {
  for (const eco of PARSED_DEPENDENCY_ECOSYSTEMS) {
    for (const rel of manifests.get(eco) ?? []) {
      for (const dependency of manifestDependencies(
        root,
        eco,
        rel,
        cache,
        state,
      )) {
        for (const rule of TEXT_TOOLING) {
          if (rule.eco === eco && rule.pkg === dependency) {
            recordTooling(acc, rule, `${eco} dep: ${dependency}`);
          }
        }
        const framework = FRAMEWORK_INDEX.get(`${eco}:${dependency}`);
        if (framework && !frameworks.has(framework.name)) {
          frameworks.set(framework.name, {
            name: framework.name,
            via: `${eco} dep: ${dependency}`,
            confidence: "authoritative",
          });
        }
      }
    }
  }
}

function buildLanguages(
  acc: WalkAccumulator,
  topLocations: number,
  state: CollectionState,
): LanguageEntry[] {
  return [...acc.langFiles.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, files]) => {
      const dirs = acc.langDirs.get(name) ?? new Map<string, number>();
      const limit = Math.max(0, topLocations);
      if (dirs.size > limit) {
        addTruncation(state, {
          reason: "languageLocations",
          limit,
          observed: dirs.size,
          omitted: dirs.size - limit,
          subject: name,
        });
      }
      return {
        name,
        files,
        locations: topKeys(dirs, limit),
        confidence: "heuristic" as const,
      };
    });
}

function buildEcosystems(acc: WalkAccumulator): EcosystemEntry[] {
  return [...acc.manifests.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, manifests]) => ({
      name,
      manifests: [...manifests].sort(),
      confidence: "authoritative",
    }));
}

function buildTooling(
  acc: WalkAccumulator,
  state: CollectionState,
): ToolingEntry[] {
  return [...acc.tooling.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, entry]) => {
      if (entry.omittedEvidence > 0) {
        addTruncation(state, {
          reason: "toolingEvidenceCollection",
          limit: STACK_COLLECTION_LIMITS.evidencePerTool,
          observed:
            STACK_COLLECTION_LIMITS.evidencePerTool + entry.omittedEvidence,
          omitted: entry.omittedEvidence,
          subject: name,
        });
      }
      return {
        name,
        kinds: [...entry.kinds].sort(),
        evidence: [...entry.evidence].sort(),
        confidence: "authoritative" as const,
      };
    });
}

function rootName(root: string): string {
  return root.split("/").filter(Boolean).pop() ?? root;
}

function emptyStack(
  root: string,
  warning: string,
  truncations: readonly StackTruncation[] = [],
): StackContextData {
  return {
    root,
    name: rootName(root),
    scannedFiles: 0,
    truncations,
    languages: [],
    ecosystems: [],
    tooling: [],
    frameworks: [],
    warnings: [warning],
  };
}

/** Produce a deterministic, bounded stack summary for a Git worktree. */
export function detectStack(options: StackContextOptions): StackContextData {
  const { root } = options;
  try {
    if (!statSync(root).isDirectory()) {
      return emptyStack(root, `'${root}' is not a readable directory.`);
    }
  } catch {
    return emptyStack(root, `'${root}' is not a readable directory.`);
  }

  const files = gitFiles(root);
  if (!files.ok) return emptyStack(root, files.warning);

  const state: CollectionState = {
    warnings: [],
    warningSet: new Set(),
    truncations: [],
    manifestBytesRead: 0,
    omittedWarnings: 0,
    omittedTruncations: 0,
  };
  if (files.outputTruncated) {
    addTruncation(state, {
      reason: "gitFileListBytes",
      limit: STACK_COLLECTION_LIMITS.gitFileListBytes,
      observed: files.observedBytes,
    });
    addWarning(
      state,
      `Git file listing exceeded ${STACK_COLLECTION_LIMITS.gitFileListBytes} bytes; results are partial.`,
    );
  }

  const acc = walk(root, options, files.files, state);
  const frameworks = new Map<string, FrameworkEntry>();
  const cache = new Map<string, ManifestCacheEntry>();
  detectNpm(root, acc.manifests, acc, frameworks, cache, state);
  detectParsedDependencies(root, acc.manifests, acc, frameworks, cache, state);
  const languages = buildLanguages(acc, options.topLocations, state);
  const ecosystems = buildEcosystems(acc);
  const tooling = buildTooling(acc, state);

  return {
    root,
    name: rootName(root),
    scannedFiles: acc.scannedFiles,
    truncations: finalTruncations(state),
    languages,
    ecosystems,
    tooling,
    frameworks: [...frameworks.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    warnings: state.warnings,
  };
}
