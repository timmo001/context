/** Environment variables used by context. */
export const ENV = {
  CONTEXT_DEBUG: "CONTEXT_DEBUG",
  CONTEXT_GITHUB_RETRIES: "CONTEXT_GITHUB_RETRIES",
  CONTEXT_GITHUB_RATE_LIMIT_TTL_SECONDS:
    "CONTEXT_GITHUB_RATE_LIMIT_TTL_SECONDS",
  CONTEXT_GITHUB_RATE_LIMIT_MIN_REMAINING:
    "CONTEXT_GITHUB_RATE_LIMIT_MIN_REMAINING",
  CONTEXT_GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS:
    "CONTEXT_GITHUB_RATE_LIMIT_MAX_WAIT_SECONDS",
  NO_COLOR: "NO_COLOR",
} as const;

/** Read an environment variable as a string. */
export function envString(name: string): string | undefined {
  return process.env[name];
}

/** Read a non-negative integer from the environment, falling back on invalid input. */
export function envNonNegativeInt(name: string, fallback: number): number {
  const value = envString(name);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
