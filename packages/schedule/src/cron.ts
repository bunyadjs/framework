/**
 * Match a 5-field cron expression (min hour dom month dow) against date parts.
 * Supports "*", "n", step ranges, "a-b", and comma lists.
 */
export type CronDateParts = {
  minutes: number;
  hours: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
};

export function cronMatchesParts(
  expression: string,
  parts: CronDateParts,
): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: ${expression}`);
  }
  const [min, hour, dom, month, dow] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];

  return (
    fieldMatches(min, parts.minutes, 0, 59) &&
    fieldMatches(hour, parts.hours, 0, 23) &&
    fieldMatches(dom, parts.dayOfMonth, 1, 31) &&
    fieldMatches(month, parts.month, 1, 12) &&
    fieldMatches(dow, parts.dayOfWeek, 0, 6)
  );
}

export function cronMatches(
  expression: string,
  date: Date,
  timeZone?: string,
): boolean {
  return cronMatchesParts(
    expression,
    timeZone ? zonedParts(date, timeZone) : localParts(date),
  );
}

export function localParts(date: Date): CronDateParts {
  return {
    minutes: date.getMinutes(),
    hours: date.getHours(),
    dayOfMonth: date.getDate(),
    month: date.getMonth() + 1,
    dayOfWeek: date.getDay(),
  };
}

/** Resolve cron parts in an IANA timezone (e.g. `America/New_York`). */
export function zonedParts(date: Date, timeZone: string): CronDateParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });

  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    minutes: Number(bag.minute),
    hours: Number(bag.hour),
    dayOfMonth: Number(bag.day),
    month: Number(bag.month),
    dayOfWeek: weekdayMap[bag.weekday ?? "Sun"] ?? 0,
  };
}

function fieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  if (field === "*") return true;

  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [range, stepRaw] = part.split("/");
      const step = Number(stepRaw);
      const [start, end] = parseRange(
        range === "*" ? `${min}-${max}` : range!,
        min,
        max,
      );
      for (let i = start; i <= end; i += step) {
        if (i === value) return true;
      }
      continue;
    }
    if (part.includes("-")) {
      const [start, end] = parseRange(part, min, max);
      if (value >= start && value <= end) return true;
      continue;
    }
    if (Number(part) === value) return true;
  }
  return false;
}

function parseRange(
  range: string,
  min: number,
  max: number,
): [number, number] {
  if (range === "*") return [min, max];
  const [a, b] = range.split("-").map(Number);
  return [a ?? min, b ?? a ?? max];
}
