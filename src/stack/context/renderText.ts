/** Bounded, control-safe human renderer for stack context. */
import { plainStyler, type Styler } from "../../lib/ansi.js";
import { escapeTextControls } from "../../lib/text.js";
import { STACK_LIMITS } from "./model.js";
import type {
  EcosystemEntry,
  FrameworkEntry,
  LanguageEntry,
  StackContextData,
  StackTruncation,
  StackTruncationReason,
  ToolingEntry,
  ToolingKind,
} from "./model.js";

const TOOLING_KIND_ORDER: readonly ToolingKind[] = [
  "package manager",
  "task runner",
  "linter",
  "formatter",
  "build tool",
  "test runner",
  "git hook",
  "release tool",
];

interface MutableTruncation {
  reason: StackTruncationReason;
  limit: number;
  observed?: number;
  omitted?: number;
  subject?: string;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, limit: number): string {
  if (utf8Bytes(value) <= limit) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8Bytes(value.slice(0, middle)) <= limit) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low).replace(/[\uD800-\uDBFF]$/, "");
}

function addTruncation(
  truncations: MutableTruncation[],
  truncation: StackTruncation,
): void {
  const existing = truncations.find(
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
  } else {
    truncations.push({ ...truncation });
  }
}

function capList<T>(
  values: readonly T[],
  limit: number,
  reason: StackTruncationReason,
  truncations: MutableTruncation[],
  subject?: string,
): readonly T[] {
  if (values.length > limit) {
    addTruncation(truncations, {
      reason,
      limit,
      observed: values.length,
      omitted: values.length - limit,
      subject,
    });
  }
  return values.slice(0, limit);
}

function safeText(value: string, truncations: MutableTruncation[]): string {
  const sanitised = escapeTextControls(value);
  const observed = utf8Bytes(sanitised);
  if (observed <= STACK_LIMITS.outputValueBytes) return sanitised;
  addTruncation(truncations, {
    reason: "outputValueBytes",
    limit: STACK_LIMITS.outputValueBytes,
    observed,
    omitted: observed - STACK_LIMITS.outputValueBytes,
  });
  return truncateUtf8(sanitised, STACK_LIMITS.outputValueBytes);
}

function percentage(count: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(1, Math.round((count / total) * 100))}%`;
}

function formatLanguage(
  language: LanguageEntry,
  totalLanguageFiles: number,
  styler: Styler,
  truncations: MutableTruncation[],
): string {
  const name = safeText(language.name, truncations);
  const locations = capList(
    language.locations,
    STACK_LIMITS.locationsPerLanguage,
    "languageLocationsOutput",
    truncations,
    name,
  );
  const noun = language.files === 1 ? "file" : "files";
  return `${styler.label(name)}  ${language.files} ${noun} (${percentage(language.files, totalLanguageFiles)})  · ${locations.length ? locations.map((location) => safeText(location, truncations)).join(", ") : "(root)"}`;
}

function formatEcosystem(
  ecosystem: EcosystemEntry,
  styler: Styler,
  truncations: MutableTruncation[],
): string {
  const name = safeText(ecosystem.name, truncations);
  const shown = capList(
    ecosystem.manifests,
    STACK_LIMITS.textManifestsPerEcosystem,
    "ecosystemManifestOutput",
    truncations,
    name,
  );
  const extra = ecosystem.manifests.length - shown.length;
  return `${styler.label(`${name}:`)} ${shown.map((manifest) => safeText(manifest, truncations)).join(", ") || "(none)"}${extra > 0 ? ` (+${extra} more)` : ""}`;
}

function formatFramework(
  framework: FrameworkEntry,
  styler: Styler,
  truncations: MutableTruncation[],
): string {
  return `${styler.label(safeText(framework.name, truncations))}  ${styler.dim(safeText(framework.via, truncations))}`;
}

function formatTooling(
  tool: ToolingEntry,
  styler: Styler,
  truncations: MutableTruncation[],
): string {
  const name = safeText(tool.name, truncations);
  const evidence = capList(
    tool.evidence,
    STACK_LIMITS.textEvidencePerTool,
    "toolingEvidenceOutput",
    truncations,
    name,
  );
  return `${styler.label(name)}  ${tool.kinds.join(", ")}${evidence.length ? `  · ${styler.dim(evidence.map((item) => safeText(item, truncations)).join(", "))}` : ""}`;
}

function groupedToolingRows(
  tools: readonly ToolingEntry[],
  styler: Styler,
  truncations: MutableTruncation[],
): string[] {
  const rows: string[] = [];
  const rendered = new Set<string>();
  for (const kind of TOOLING_KIND_ORDER) {
    const group = tools.filter(
      (tool) => !rendered.has(tool.name) && tool.kinds.includes(kind),
    );
    if (group.length === 0) continue;
    rows.push(styler.heading(`${kind}:`));
    for (const tool of group) {
      rows.push(`  ${formatTooling(tool, styler, truncations)}`);
      rendered.add(tool.name);
    }
  }
  for (const tool of tools) {
    if (!rendered.has(tool.name)) {
      rows.push(formatTooling(tool, styler, truncations));
    }
  }
  return rows;
}

function appendSection(
  lines: string[],
  styler: Styler,
  title: string,
  count: number,
  rows: readonly string[],
): void {
  lines.push(styler.heading(`${title} (${count}):`));
  if (rows.length === 0) lines.push("  (none detected)");
  else for (const row of rows) lines.push(`  ${row}`);
  lines.push("");
}

function truncationRow(truncation: StackTruncation): string {
  const details = [
    `limit=${truncation.limit}`,
    truncation.observed === undefined
      ? null
      : `observed=${truncation.observed}`,
    truncation.omitted === undefined ? null : `omitted=${truncation.omitted}`,
    truncation.subject === undefined ? null : `subject=${truncation.subject}`,
  ].filter((value): value is string => value !== null);
  return `${truncation.reason}: ${details.join(" ")}`;
}

function capTruncations(
  truncations: readonly StackTruncation[],
): readonly StackTruncation[] {
  const ordered = [...truncations].sort(
    (a, b) =>
      a.reason.localeCompare(b.reason) ||
      (a.subject ?? "").localeCompare(b.subject ?? "") ||
      a.limit - b.limit,
  );
  if (ordered.length <= STACK_LIMITS.truncationReasons) return ordered;
  return [
    ...ordered.slice(0, STACK_LIMITS.truncationReasons - 1),
    {
      reason: "truncationReasonsOutput",
      limit: STACK_LIMITS.truncationReasons,
      observed: ordered.length,
      omitted: ordered.length - STACK_LIMITS.truncationReasons + 1,
    },
  ];
}

/** Render bounded text and escape repository-controlled control characters. */
export function renderStackContextText(
  data: StackContextData,
  styler: Styler = plainStyler,
): string {
  const truncations: MutableTruncation[] = [];
  for (const entry of data.truncations) {
    addTruncation(truncations, {
      ...entry,
      subject:
        entry.subject === undefined
          ? undefined
          : safeText(entry.subject, truncations),
    });
  }
  const languages = capList(
    data.languages,
    STACK_LIMITS.languages,
    "languagesOutput",
    truncations,
  );
  const ecosystems = capList(
    data.ecosystems,
    STACK_LIMITS.ecosystems,
    "ecosystemsOutput",
    truncations,
  );
  const tooling = capList(
    data.tooling,
    STACK_LIMITS.tooling,
    "toolingOutput",
    truncations,
  );
  const frameworks = capList(
    data.frameworks,
    STACK_LIMITS.frameworks,
    "frameworksOutput",
    truncations,
  );
  const warnings = capList(
    data.warnings,
    STACK_LIMITS.warnings,
    "warnings",
    truncations,
  );
  const lines: string[] = [
    `${styler.heading("Stack:")} ${safeText(data.name, truncations)} (${safeText(data.root, truncations)})`,
    `${data.scannedFiles} files scanned`,
    "",
  ];
  const totalLanguageFiles = data.languages.reduce(
    (sum, language) => sum + language.files,
    0,
  );
  appendSection(
    lines,
    styler,
    "Languages",
    data.languages.length,
    languages.map((language) =>
      formatLanguage(language, totalLanguageFiles, styler, truncations),
    ),
  );
  appendSection(
    lines,
    styler,
    "Ecosystems",
    data.ecosystems.length,
    ecosystems.map((ecosystem) =>
      formatEcosystem(ecosystem, styler, truncations),
    ),
  );
  appendSection(
    lines,
    styler,
    "Tooling",
    data.tooling.length,
    groupedToolingRows(tooling, styler, truncations),
  );
  appendSection(
    lines,
    styler,
    "Frameworks",
    data.frameworks.length,
    frameworks.map((framework) =>
      formatFramework(framework, styler, truncations),
    ),
  );

  const warningLines = warnings.map((warning) =>
    styler.warn(`! ${safeText(warning, truncations)}`),
  );
  if (truncations.length > 0) {
    const shown = capTruncations(truncations);
    appendSection(
      lines,
      styler,
      "Truncations",
      truncations.length,
      shown.map(truncationRow),
    );
  }
  if (warningLines.length > 0) {
    lines.push(...warningLines);
    lines.push("");
  }
  lines.push(
    styler.markdown(
      "Use --json for the stack-context plugin payload. `context stack --help` lists all flags.",
    ),
  );

  const rendered = `${lines.join("\n")}\n`;
  const observed = utf8Bytes(rendered);
  if (observed <= STACK_LIMITS.textOutputBytes) return rendered;
  const suffix = `\nTruncations (1):\n  textOutputBytes: limit=${STACK_LIMITS.textOutputBytes} observed=${observed} omitted=${observed - STACK_LIMITS.textOutputBytes}\n`;
  return `${truncateUtf8(rendered, STACK_LIMITS.textOutputBytes - utf8Bytes(suffix))}${suffix}`;
}
