import { Effect, Predicate } from "effect";

/** Write text to stdout exactly as provided. */
export function writeText(text: string): Effect.Effect<void> {
  return Effect.sync(() => process.stdout.write(text));
}

/** Format an unknown command error for CLI output. */
export function formatCommandError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (Predicate.hasProperty(cause, "message")) {
    const message = cause.message;
    if (Predicate.isString(message) && message.length > 0) return message;
  }
  return String(cause);
}

/** Print a labelled command error and exit non-zero. */
export function handleCommandError(label: string) {
  return Effect.catch((cause: unknown) =>
    Effect.sync(() => {
      console.error(`[${label}] ${formatCommandError(cause)}`);
      process.exitCode = 1;
    }),
  );
}
