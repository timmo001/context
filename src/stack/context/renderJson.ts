/** Bounded JSON renderer for the stack-context 0.2 payload. */
import { STACK_LIMITS } from "./model.js";
import { escapeTextControls } from "../../lib/text.js";
import type {
  StackContextData,
  StackTruncation,
  StackTruncationReason,
} from "./model.js";

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

function boundedValue(value: string, truncations: MutableTruncation[]): string {
  const escaped = escapeTextControls(value);
  const observed = utf8Bytes(escaped);
  if (observed <= STACK_LIMITS.outputValueBytes) return escaped;
  addTruncation(truncations, {
    reason: "outputValueBytes",
    limit: STACK_LIMITS.outputValueBytes,
    observed,
    omitted: observed - STACK_LIMITS.outputValueBytes,
  });
  return truncateUtf8(escaped, STACK_LIMITS.outputValueBytes);
}

function capTruncations(
  truncations: readonly MutableTruncation[],
): readonly StackTruncation[] {
  const ordered = [...truncations].sort(
    (a, b) =>
      a.reason.localeCompare(b.reason) ||
      (a.subject ?? "").localeCompare(b.subject ?? "") ||
      a.limit - b.limit,
  );
  if (ordered.length <= STACK_LIMITS.truncationReasons) return ordered;
  const kept = ordered.slice(0, STACK_LIMITS.truncationReasons - 1);
  kept.push({
    reason: "truncationReasonsOutput",
    limit: STACK_LIMITS.truncationReasons,
    observed: ordered.length,
    omitted: ordered.length - STACK_LIMITS.truncationReasons + 1,
  });
  return kept;
}

/** Render a bounded JSON payload with explicit scan and output truncations. */
export function renderStackContextJson(data: StackContextData): string {
  const truncations: MutableTruncation[] = [];
  const value = (text: string) => boundedValue(text, truncations);
  for (const entry of data.truncations) {
    addTruncation(truncations, {
      ...entry,
      subject: entry.subject === undefined ? undefined : value(entry.subject),
    });
  }

  const languages = capList(
    data.languages,
    STACK_LIMITS.languages,
    "languagesOutput",
    truncations,
  ).map((language) => {
    const name = value(language.name);
    return {
      ...language,
      name,
      locations: capList(
        language.locations,
        STACK_LIMITS.locationsPerLanguage,
        "languageLocationsOutput",
        truncations,
        name,
      ).map(value),
    };
  });
  const ecosystems = capList(
    data.ecosystems,
    STACK_LIMITS.ecosystems,
    "ecosystemsOutput",
    truncations,
  ).map((ecosystem) => {
    const name = value(ecosystem.name);
    return {
      ...ecosystem,
      name,
      manifests: capList(
        ecosystem.manifests,
        STACK_LIMITS.manifestsPerEcosystem,
        "ecosystemManifestOutput",
        truncations,
        name,
      ).map(value),
    };
  });
  const tooling = capList(
    data.tooling,
    STACK_LIMITS.tooling,
    "toolingOutput",
    truncations,
  ).map((tool) => {
    const name = value(tool.name);
    return {
      ...tool,
      name,
      evidence: capList(
        tool.evidence,
        STACK_LIMITS.evidencePerTool,
        "toolingEvidenceOutput",
        truncations,
        name,
      ).map(value),
    };
  });
  const frameworks = capList(
    data.frameworks,
    STACK_LIMITS.frameworks,
    "frameworksOutput",
    truncations,
  ).map((framework) => ({
    ...framework,
    name: value(framework.name),
    via: value(framework.via),
  }));
  const warnings = capList(
    data.warnings,
    STACK_LIMITS.warnings,
    "warnings",
    truncations,
  ).map(value);

  const payload = {
    root: value(data.root),
    name: value(data.name),
    scannedFiles: data.scannedFiles,
    truncations: capTruncations(truncations),
    languages,
    ecosystems,
    tooling,
    frameworks,
    warnings,
  };
  const rendered = JSON.stringify(payload);
  const observed = utf8Bytes(rendered);
  if (observed <= STACK_LIMITS.jsonOutputBytes) return rendered;

  const fallbackTruncations = [...truncations];
  addTruncation(fallbackTruncations, {
    reason: "jsonOutputBytes",
    limit: STACK_LIMITS.jsonOutputBytes,
    observed,
    omitted: observed - STACK_LIMITS.jsonOutputBytes,
  });
  for (const [reason, count] of [
    ["languagesOutput", languages.length],
    ["ecosystemsOutput", ecosystems.length],
    ["toolingOutput", tooling.length],
    ["frameworksOutput", frameworks.length],
    ["warnings", warnings.length],
  ] as const) {
    if (count > 0) {
      addTruncation(fallbackTruncations, {
        reason,
        limit: 0,
        observed: count,
        omitted: count,
      });
    }
  }
  return JSON.stringify({
    root: truncateUtf8(
      escapeTextControls(data.root),
      STACK_LIMITS.outputValueBytes,
    ),
    name: truncateUtf8(
      escapeTextControls(data.name),
      STACK_LIMITS.outputValueBytes,
    ),
    scannedFiles: data.scannedFiles,
    truncations: capTruncations(fallbackTruncations),
    languages: [],
    ecosystems: [],
    tooling: [],
    frameworks: [],
    warnings: [],
  });
}
