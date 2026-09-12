import { DateTime, Duration, Option, Schema } from "effect";

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

  const month = MONTHS.findIndex((name) => name === rfc[2].toLowerCase());
  const rawYear = Number(rfc[3]);
  const year =
    rfc[3].length === 2
      ? rawYear <= 49
        ? 2000 + rawYear
        : 1900 + rawYear
      : rawYear;
  return month !== -1 && isValidCalendarDate(year, month + 1, Number(rfc[1]));
}

const relativeUnits = new Map<string, Duration.Unit>([
  ["s", "seconds"],
  ["sec", "seconds"],
  ["secs", "seconds"],
  ["m", "minutes"],
  ["min", "minutes"],
  ["mins", "minutes"],
  ["h", "hours"],
  ["hr", "hours"],
  ["hrs", "hours"],
  ["d", "days"],
  ["w", "weeks"],
  ["ms", "millis"],
  ["us", "micros"],
  ["ns", "nanos"],
]);

const decodeDuration = Schema.decodeUnknownOption(Schema.DurationFromString);

function parseRelativeSinceTimestamp(value: string): number | undefined {
  const duration = decodeDuration(
    value
      .toLowerCase()
      .replace(
        /\s*([a-z]+)(?:\s+ago)?$/,
        (_, unit: string) => ` ${relativeUnits.get(unit) ?? unit}`,
      ),
  );
  return Option.isSome(duration)
    ? DateTime.toEpochMillis(
        DateTime.subtractDuration(DateTime.nowUnsafe(), duration.value),
      )
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

  const date = DateTime.make(parseSinceTimestamp(trimmed));
  return DateTime.formatIso(
    Option.getOrThrowWith(date, () => invalidSince(value)),
  );
}
