/** Return whether an option flag is present. */
export function hasOption(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

/** Return an option value from `--flag value` or `--flag=value`. */
export function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const equals = args.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("-") ? value : undefined;
}

/** Parse ISO/RFC/epoch/relative date values to ISO strings. */
export function parseSince(value: string): string {
  const trimmed = value.trim();
  const timestamp = parseSinceTimestamp(trimmed);
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `Unknown --since value: ${value} (expected an ISO/RFC date, epoch timestamp, or relative duration like 2d / 2 days ago)`,
    );
  }
  return new Date(timestamp).toISOString();
}

function parseSinceTimestamp(value: string): number {
  if (/^\d+$/.test(value)) return normalizeEpoch(Number(value));
  return parseRelativeSinceTimestamp(value) ?? Date.parse(value);
}

function parseRelativeSinceTimestamp(value: string): number | undefined {
  const match = value
    .toLowerCase()
    .match(
      /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)(?:\s+ago)?$/,
    );
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const millis = relativeUnitMillis(match[2]);
  return millis === undefined ? undefined : Date.now() - amount * millis;
}

function relativeUnitMillis(unit: string | undefined): number | undefined {
  switch (unit) {
    case "s":
    case "sec":
    case "secs":
    case "second":
    case "seconds":
      return 1_000;
    case "m":
    case "min":
    case "mins":
    case "minute":
    case "minutes":
      return 60_000;
    case "h":
    case "hr":
    case "hrs":
    case "hour":
    case "hours":
      return 3_600_000;
    case "d":
    case "day":
    case "days":
      return 86_400_000;
    case "w":
    case "week":
    case "weeks":
      return 604_800_000;
    default:
      return undefined;
  }
}

function normalizeEpoch(epoch: number): number {
  return epoch < 10_000_000_000 ? epoch * 1000 : epoch;
}
