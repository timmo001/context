/** Shared ANSI styling for CLI text output. */
import { ENV, envString } from "./env.js";

/** Raw ANSI escape codes for terminal styling. */
export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
} as const;

/** Semantic styler for CLI text output. */
export interface Styler {
  /** Style a section or field heading. */
  readonly heading: (text: string) => string;
  /** Style an inline field label. */
  readonly label: (text: string) => string;
  /** Style an inline command or flag. */
  readonly command: (text: string) => string;
  /** Style de-emphasised text. */
  readonly dim: (text: string) => string;
  /** Style a success marker. */
  readonly success: (text: string) => string;
  /** Style a warning line. */
  readonly warn: (text: string) => string;
  /** Highlight markdown inline-code spans. */
  readonly markdown: (text: string) => string;
}

const identity = (text: string): string => text;

/** No-op styler used for non-TTY, captured, and MCP output. */
export const plainStyler: Styler = {
  heading: identity,
  label: identity,
  command: identity,
  dim: identity,
  success: identity,
  warn: identity,
  markdown: identity,
};

/** Whether ANSI colour should be emitted for `stream`. */
export function colorEnabled(
  stream: { readonly isTTY?: boolean } = process.stdout,
): boolean {
  const noColor = envString(ENV.NO_COLOR);
  if (noColor !== undefined && noColor !== "") return false;
  return stream.isTTY === true;
}

function wrap(codes: string): (text: string) => string {
  return (text) => `${codes}${text}${ANSI.reset}`;
}

const command = wrap(ANSI.green);

/** Colour-emitting styler used on an interactive TTY. */
export const colorStyler: Styler = {
  heading: wrap(`${ANSI.bold}${ANSI.cyan}`),
  label: wrap(ANSI.bold),
  command,
  dim: wrap(ANSI.dim),
  success: command,
  warn: wrap(ANSI.yellow),
  markdown: (text) =>
    text.replace(/`([^`]+)`/g, (_match, code: string) => command(code)),
};

/** Resolve the styler for `stream`. */
export function cliStyler(
  stream: { readonly isTTY?: boolean } = process.stdout,
): Styler {
  return colorEnabled(stream) ? colorStyler : plainStyler;
}
