const MAX_DATE_TIMESTAMP = 8_640_000_000_000_000;

function invalidSince(value: string): Error {
  return new Error(
    `Unknown --since value: ${value} (expected an ISO/RFC date, epoch timestamp, or relative duration like 2d / 2 days ago)`,
  );
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;

function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (month < 1 || month > 12 || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function isValidDateSyntax(value: string): boolean {
  const iso = /^([+-]?\d{4,6})-(\d{2})-(\d{2})(?=$|T|\s)/.exec(value);
  if (iso) {
    return isValidCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const rfc =
    /^(?:[A-Za-z]+,\s*)?(\d{1,2})[\s-]+([A-Za-z]{3})[\s-]+(\d{2,4})(?=\s|$)/.exec(
      value,
    );
  if (!rfc) return false;

  const month = MONTHS.indexOf(rfc[2].toLowerCase() as (typeof MONTHS)[number]);
  const rawYear = Number(rfc[3]);
  const year =
    rfc[3].length === 2
      ? rawYear <= 49
        ? 2000 + rawYear
        : 1900 + rawYear
      : rawYear;
  return month !== -1 && isValidCalendarDate(year, month + 1, Number(rfc[1]));
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

function parseRelativeSinceTimestamp(value: string): number | undefined {
  const match = value
    .toLowerCase()
    .match(
      /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)(?:\s+ago)?$/,
    );
  if (!match) return undefined;

  const amount = Number(match[1]);
  const millis = relativeUnitMillis(match[2]);
  return Number.isFinite(amount) && millis !== undefined
    ? Date.now() - amount * millis
    : undefined;
}

function parseSinceTimestamp(value: string): number {
  if (/^\d+$/.test(value)) {
    const epoch = Number(value);
    return epoch < 10_000_000_000 ? epoch * 1000 : epoch;
  }
  const relative = parseRelativeSinceTimestamp(value);
  if (relative !== undefined) return relative;
  return isValidDateSyntax(value) ? Date.parse(value) : Number.NaN;
}

/** Parse and validate an ISO/RFC/epoch/relative date as an ISO string. */
export function parseSince(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw invalidSince(value);

  const timestamp = parseSinceTimestamp(trimmed);
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > MAX_DATE_TIMESTAMP) {
    throw invalidSince(value);
  }

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw invalidSince(value);
  return date.toISOString();
}
