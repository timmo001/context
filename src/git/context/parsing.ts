import { escapeTextControls } from "../../lib/text.js";
import type { FileChange } from "./model.js";

/** Added/deleted line counts for a single file. `null` denotes a binary file. */
export interface DiffCounts {
  readonly added: number | null;
  readonly deleted: number | null;
}

function parseCount(value: string): number | null {
  if (value === "-") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse `git diff --numstat -z` output without interpreting path contents. */
export function parseNumstatZ(output: string): Map<string, DiffCounts> {
  const fields = output.split("\0");
  const counts = new Map<string, DiffCounts>();
  for (let index = 0; index < fields.length - 1;) {
    const record = (fields[index++] ?? "").replace(/^\n+/, "");
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;
    const added = record.slice(0, firstTab);
    const deleted = record.slice(firstTab + 1, secondTab);
    const path = record.slice(secondTab + 1);
    if (!added || !deleted) continue;
    const destination = path || fields[index + 1] || fields[index] || "";
    if (!path) index += 2;
    if (destination) {
      counts.set(destination, {
        added: parseCount(added),
        deleted: parseCount(deleted),
      });
    }
  }
  return counts;
}

function displayRaw(
  status: string,
  path: string,
  originalPath?: string,
): string {
  const escapedPath = escapeTextControls(path);
  return originalPath === undefined
    ? `${status}\t${escapedPath}`
    : `${status}\t${escapeTextControls(originalPath)}\t${escapedPath}`;
}

/** Build a file change from an already-delimited status record. */
export function fileChange(
  status: string,
  path: string,
  counts: ReadonlyMap<string, DiffCounts>,
  originalPath?: string,
): FileChange {
  const diffCounts = counts.get(path);
  return {
    raw: displayRaw(status, path, originalPath),
    status,
    path,
    ...(originalPath === undefined ? {} : { originalPath }),
    countsKnown: diffCounts !== undefined,
    added: diffCounts?.added ?? null,
    deleted: diffCounts?.deleted ?? null,
  };
}

/** Parse `git diff --name-status -z` output, including rename source paths. */
export function parseNameStatusZ(
  output: string,
  counts: ReadonlyMap<string, DiffCounts>,
): FileChange[] {
  const fields = output.split("\0");
  const changes: FileChange[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++] ?? "";
    const firstPath = fields[index++] ?? "";
    if (!status || !firstPath) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const destination = fields[index++] ?? "";
      if (destination)
        changes.push(fileChange(status, destination, counts, firstPath));
    } else {
      changes.push(fileChange(status, firstPath, counts));
    }
  }
  return changes;
}

/** Parse a NUL-delimited path list such as `git ls-files -z`. */
export function parseUntrackedZ(output: string): FileChange[] {
  return output
    .split("\0")
    .filter(Boolean)
    .map((path) => fileChange("??", path, new Map()));
}

/** Render `git status --short --branch -z` as safe line-oriented text. */
export function parseShortStatusZ(output: string): string {
  const fields = output.split("\0");
  const lines: string[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const record = fields[index++] ?? "";
    if (!record) continue;
    if (record.startsWith("## ")) {
      lines.push(`## ${escapeTextControls(record.slice(3))}`);
      continue;
    }
    const prefix = record.slice(0, 3);
    const destination = record.slice(3);
    if (prefix.startsWith("R") || prefix.startsWith("C")) {
      const source = fields[index++] ?? "";
      lines.push(
        `${prefix}${escapeTextControls(source)} -> ${escapeTextControls(destination)}`,
      );
    } else {
      lines.push(`${prefix}${escapeTextControls(destination)}`);
    }
  }
  return lines.join("\n");
}
