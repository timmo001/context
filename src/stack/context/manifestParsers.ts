/** Focused declared-dependency parsers for supported non-npm manifests. */
import { Schema } from "effect";

type ManifestValue =
  | null
  | string
  | number
  | boolean
  | bigint
  | Date
  | readonly ManifestValue[]
  | ManifestTable;

interface ManifestTable {
  readonly [key: string]: ManifestValue;
}

const ManifestValueSchema: Schema.Codec<
  ManifestValue,
  ManifestValue,
  never,
  never
> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.BigInt,
    Schema.Date,
    Schema.Array(ManifestValueSchema),
    ManifestTableSchema,
  ]),
);

const ManifestTableSchema: Schema.Codec<
  ManifestTable,
  ManifestTable,
  never,
  never
> = Schema.Record(Schema.String, ManifestValueSchema);

const isManifestTable = Schema.is(ManifestTableSchema);
const isString = Schema.is(Schema.String);

function ownValue(
  value: ManifestTable,
  key: string,
): ManifestValue | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Parse a Python requirement and return its normalised distribution name. */
export function pythonRequirementName(requirement: string): string | null {
  const withoutComment = requirement.replace(/\s+#.*$/, "").trim();
  if (
    !withoutComment ||
    withoutComment.startsWith("#") ||
    withoutComment.startsWith("-") ||
    /^[a-z][a-z+.-]*:\/\//i.test(withoutComment)
  ) {
    return null;
  }

  const match =
    /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(?:\[[^\]\r\n]+\])?(?=\s*(?:[<>=!~;@]|$))/.exec(
      withoutComment,
    );
  return match?.[1]?.toLowerCase().replace(/[._-]+/g, "-") ?? null;
}

function parseGoToken(value: string): string | null {
  const token = /^("(?:[^"\\]|\\.)*"|\S+)/.exec(value)?.[1];
  if (!token) return null;
  if (!token.startsWith('"')) return token;
  try {
    return Schema.decodeUnknownSync(Schema.String)(JSON.parse(token));
  } catch {
    return null;
  }
}

/** Parse module paths from single and parenthesised go.mod require directives. */
export function parseGoModDependencies(text: string): string[] {
  const dependencies = new Set<string>();
  let inRequireBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (inRequireBlock) {
      if (line === ")") {
        inRequireBlock = false;
        continue;
      }
      const dependency = parseGoToken(line);
      if (dependency) dependencies.add(dependency);
      continue;
    }
    if (/^require\s*\($/.test(line)) {
      inRequireBlock = true;
      continue;
    }
    const single = /^require\s+(.+)$/.exec(line);
    if (!single) continue;
    const dependency = parseGoToken(single[1] ?? "");
    if (dependency) dependencies.add(dependency);
  }

  return sorted(dependencies);
}

const CARGO_DEPENDENCY_TABLES = new Set([
  "dependencies",
  "dev-dependencies",
  "build-dependencies",
]);

function collectCargoDependencyTable(
  table: ManifestTable,
  dependencies: Set<string>,
): void {
  for (const [name, declaration] of Object.entries(table)) {
    const packageName = isManifestTable(declaration)
      ? ownValue(declaration, "package")
      : undefined;
    dependencies.add(
      isString(packageName) ? packageName.toLowerCase() : name.toLowerCase(),
    );
  }
}

function collectCargoScope(
  value: ManifestValue | undefined,
  dependencies: Set<string>,
): void {
  if (!isManifestTable(value)) return;
  for (const tableName of CARGO_DEPENDENCY_TABLES) {
    const table = ownValue(value, tableName);
    if (isManifestTable(table))
      collectCargoDependencyTable(table, dependencies);
  }
}

/** Parse Cargo dependency tables, including target and workspace nesting. */
export function parseCargoDependencies(text: string): string[] {
  const parsed = Schema.decodeUnknownSync(ManifestTableSchema)(
    Bun.TOML.parse(text),
  );
  const dependencies = new Set<string>();
  collectCargoScope(parsed, dependencies);
  collectCargoScope(ownValue(parsed, "workspace"), dependencies);
  const targets = ownValue(parsed, "target");
  if (isManifestTable(targets)) {
    for (const target of Object.values(targets)) {
      collectCargoScope(target, dependencies);
    }
  }
  return sorted(dependencies);
}

function addPythonRequirements(
  value: ManifestValue | undefined,
  dependencies: Set<string>,
): void {
  if (!Array.isArray(value)) return;
  for (const requirement of value) {
    if (!isString(requirement)) continue;
    const name = pythonRequirementName(requirement);
    if (name) dependencies.add(name);
  }
}

function collectPythonDependencyTable(
  value: ManifestValue | undefined,
  dependencies: Set<string>,
): void {
  if (!isManifestTable(value)) return;
  for (const name of Object.keys(value)) {
    if (name.toLowerCase() === "python") continue;
    dependencies.add(name.toLowerCase().replace(/[._-]+/g, "-"));
  }
}

function collectRequirementGroups(
  value: ManifestValue | undefined,
  dependencies: Set<string>,
): void {
  if (!isManifestTable(value)) return;
  for (const group of Object.values(value)) {
    addPythonRequirements(group, dependencies);
  }
}

/** Parse PEP 621 and common tool dependency containers from pyproject.toml. */
export function parsePyprojectDependencies(text: string): string[] {
  const parsed = Schema.decodeUnknownSync(ManifestTableSchema)(
    Bun.TOML.parse(text),
  );
  const dependencies = new Set<string>();
  const project = ownValue(parsed, "project");
  if (isManifestTable(project)) {
    addPythonRequirements(ownValue(project, "dependencies"), dependencies);
    collectRequirementGroups(
      ownValue(project, "optional-dependencies"),
      dependencies,
    );
  }
  collectRequirementGroups(ownValue(parsed, "dependency-groups"), dependencies);
  const buildSystem = ownValue(parsed, "build-system");
  if (isManifestTable(buildSystem)) {
    addPythonRequirements(ownValue(buildSystem, "requires"), dependencies);
  }

  const tool = ownValue(parsed, "tool");
  if (!isManifestTable(tool)) return sorted(dependencies);
  const poetry = ownValue(tool, "poetry");
  if (isManifestTable(poetry)) {
    collectPythonDependencyTable(
      ownValue(poetry, "dependencies"),
      dependencies,
    );
    collectPythonDependencyTable(
      ownValue(poetry, "dev-dependencies"),
      dependencies,
    );
    const groups = ownValue(poetry, "group");
    if (isManifestTable(groups)) {
      for (const group of Object.values(groups)) {
        if (isManifestTable(group)) {
          collectPythonDependencyTable(
            ownValue(group, "dependencies"),
            dependencies,
          );
        }
      }
    }
  }
  const pdm = ownValue(tool, "pdm");
  if (isManifestTable(pdm)) {
    collectRequirementGroups(ownValue(pdm, "dev-dependencies"), dependencies);
  }
  const uv = ownValue(tool, "uv");
  if (isManifestTable(uv)) {
    addPythonRequirements(ownValue(uv, "dev-dependencies"), dependencies);
  }
  const hatch = ownValue(tool, "hatch");
  if (isManifestTable(hatch)) {
    const envs = ownValue(hatch, "envs");
    if (isManifestTable(envs)) {
      for (const env of Object.values(envs)) {
        if (isManifestTable(env)) {
          addPythonRequirements(ownValue(env, "dependencies"), dependencies);
        }
      }
    }
  }
  return sorted(dependencies);
}

/** Parse requirements*.txt entries without treating comments or options as deps. */
export function parseRequirementsDependencies(text: string): string[] {
  const dependencies = new Set<string>();
  const logicalLines = text.replace(/\\\r?\n/g, "").split(/\r?\n/);
  for (const line of logicalLines) {
    const name = pythonRequirementName(line);
    if (name) dependencies.add(name);
  }
  return sorted(dependencies);
}

/** Parse Pipfile package and dev-package TOML tables. */
export function parsePipfileDependencies(text: string): string[] {
  const parsed = Schema.decodeUnknownSync(ManifestTableSchema)(
    Bun.TOML.parse(text),
  );
  const dependencies = new Set<string>();
  for (const tableName of ["packages", "dev-packages"]) {
    const table = ownValue(parsed, tableName);
    if (!isManifestTable(table)) continue;
    for (const name of Object.keys(table)) {
      dependencies.add(name.toLowerCase().replace(/[._-]+/g, "-"));
    }
  }
  return sorted(dependencies);
}

interface PythonListResult {
  readonly values: readonly string[];
  readonly end: number;
}

function skipPythonSpace(text: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    if (/\s/.test(text[index] ?? "")) {
      index += 1;
      continue;
    }
    if (text[index] === "#") {
      const newline = text.indexOf("\n", index + 1);
      index = newline < 0 || newline >= end ? end : newline + 1;
      continue;
    }
    break;
  }
  return index;
}

function parsePythonStringList(
  text: string,
  start: number,
  end = text.length,
): PythonListResult | null {
  if (text[start] !== "[") return null;
  const values: string[] = [];
  let index = start + 1;

  while (index < end) {
    index = skipPythonSpace(text, index, end);
    if (text[index] === "]") return { values, end: index + 1 };
    const quote = text[index];
    if (quote !== '"' && quote !== "'") return null;
    if (text.slice(index, index + 3) === quote.repeat(3)) return null;
    index += 1;
    let value = "";
    let closed = false;
    while (index < end) {
      const character = text[index] ?? "";
      if (character === "\\") {
        const escaped = text[index + 1];
        if (escaped === undefined) return null;
        value += escaped;
        index += 2;
        continue;
      }
      if (character === quote) {
        index += 1;
        closed = true;
        break;
      }
      if (character === "\n" || character === "\r") return null;
      value += character;
      index += 1;
    }
    if (!closed) return null;
    values.push(value);
    index = skipPythonSpace(text, index, end);
    if (text[index] === ",") {
      index += 1;
      continue;
    }
    if (text[index] === "]") return { values, end: index + 1 };
    return null;
  }
  return null;
}

function matchingPythonDelimiter(
  text: string,
  start: number,
  open: "(" | "{",
  close: ")" | "}",
): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") {
      const newline = text.indexOf("\n", index + 1);
      if (newline < 0) return null;
      index = newline;
      continue;
    }
    if (character === open) depth += 1;
    if (character !== close) continue;
    depth -= 1;
    if (depth === 0) return index;
  }
  return null;
}

function addSetupRequirements(
  values: readonly string[],
  dependencies: Set<string>,
): void {
  for (const requirement of values) {
    const name = pythonRequirementName(requirement);
    if (name) dependencies.add(name);
  }
}

/** Parse only literal dependency lists in setup.py setup() arguments. */
export function parseSetupPyDependencies(text: string): string[] {
  const dependencies = new Set<string>();
  const call = /^\s*(?:setup|setuptools\.setup)\s*\(/m.exec(text);
  if (!call) return [];
  const callStart = (call.index ?? 0) + call[0].length - 1;
  const callEnd = matchingPythonDelimiter(text, callStart, "(", ")");
  if (callEnd === null) return [];

  const direct =
    /(?:^|[,(])\s*(?:install_requires|tests_require|setup_requires)\s*=\s*\[/gm;
  direct.lastIndex = callStart + 1;
  for (
    let match = direct.exec(text);
    match && match.index < callEnd;
    match = direct.exec(text)
  ) {
    const start = (match.index ?? 0) + match[0].length - 1;
    const parsed = parsePythonStringList(text, start, callEnd);
    if (parsed) addSetupRequirements(parsed.values, dependencies);
    direct.lastIndex = parsed?.end ?? direct.lastIndex;
  }

  const extras = /(?:^|[,(])\s*extras_require\s*=\s*\{/gm;
  extras.lastIndex = callStart + 1;
  for (
    let match = extras.exec(text);
    match && match.index < callEnd;
    match = extras.exec(text)
  ) {
    const start = (match.index ?? 0) + match[0].length - 1;
    const end = matchingPythonDelimiter(text, start, "{", "}");
    if (end === null || end > callEnd) continue;
    const listStart = /:\s*\[/g;
    listStart.lastIndex = start + 1;
    for (
      let item = listStart.exec(text);
      item && item.index < end;
      item = listStart.exec(text)
    ) {
      const parsed = parsePythonStringList(
        text,
        item.index + item[0].length - 1,
        end,
      );
      if (parsed) addSetupRequirements(parsed.values, dependencies);
      listStart.lastIndex = parsed?.end ?? listStart.lastIndex;
    }
    extras.lastIndex = end + 1;
  }

  return sorted(dependencies);
}
