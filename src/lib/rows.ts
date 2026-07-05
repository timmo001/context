import { Effect } from "effect";

/** Write text to stdout exactly as provided. */
export function writeText(text: string): Effect.Effect<void> {
  return Effect.sync(() => process.stdout.write(text));
}

/** Format an unknown command error for CLI output. */
export function formatCommandError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return String(error);
}

/** Print a labelled command error and exit non-zero. */
export function handleCommandError(label: string) {
  return Effect.catch((error: unknown) =>
    Effect.sync(() => {
      console.error(`[${label}] ${formatCommandError(error)}`);
      process.exit(1);
    }),
  );
}
