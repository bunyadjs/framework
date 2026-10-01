import type { DriverName } from "./dialect.ts";

/**
 * Values accepted by date helpers, casts, and `whereDate`.
 * No date library is bundled — apps may pass dayjs/luxon/Temporal via duck typing
 * (`toDate()` / `valueOf()`), or plain `Date` / ISO / SQL strings.
 */
export type DateInput =
  | Date
  | string
  | number
  | { toDate: () => Date }
  | { valueOf: () => number | string };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** `YYYY-MM-DD HH:mm:ss` or `YYYY-MM-DDTHH:mm:ss` (optional fractional / offset). */
const SQL_OR_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function utcParts(d: Date): {
  y: number;
  m: number;
  day: number;
  hh: number;
  mm: number;
  ss: number;
} {
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes(),
    ss: d.getUTCSeconds(),
  };
}

/**
 * Normalize date-like input to a `Date` (UTC calendar semantics for YMD / SQL strings).
 * Duck-types dayjs/luxon (`toDate`) and other epoch wrappers (`valueOf`).
 */
export function toDate(value: DateInput): Date {
  if (value instanceof Date) return value;

  if (value != null && typeof value === "object") {
    if (typeof (value as { toDate?: unknown }).toDate === "function") {
      const d = (value as { toDate: () => Date }).toDate();
      if (d instanceof Date) return d;
    }
    if (typeof (value as { valueOf?: unknown }).valueOf === "function") {
      const raw = (value as { valueOf: () => number | string }).valueOf();
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return new Date(raw);
      }
      if (typeof raw === "string") {
        return toDate(raw);
      }
    }
  }

  if (typeof value === "number") {
    return new Date(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (YMD_RE.test(trimmed)) {
      // Calendar day at UTC midnight — same on SQLite TEXT and PG DATE.
      return new Date(`${trimmed}T00:00:00.000Z`);
    }
    const m = SQL_OR_ISO_RE.exec(trimmed);
    if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
      // Naive SQL / local-less datetime → treat as UTC (storage contract).
      return new Date(
        Date.UTC(
          Number(m[1]),
          Number(m[2]) - 1,
          Number(m[3]),
          Number(m[4]),
          Number(m[5]),
          Number(m[6]),
        ),
      );
    }
    return new Date(trimmed);
  }

  return new Date(NaN);
}

/** Calendar date `YYYY-MM-DD` (Laravel date cast storage shape). */
export function formatDateYmd(value: DateInput): string {
  const { y, m, day } = utcParts(toDate(value));
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

/** `YYYY-MM-DD HH:mm:ss` for SQLite / MySQL / MariaDB / SQL Server datetime TEXT columns. */
export function formatDateTimeSql(value: DateInput): string {
  const { y, m, day, hh, mm, ss } = utcParts(toDate(value));
  return `${y}-${pad2(m)}-${pad2(day)} ${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

/**
 * Driver-aware datetime write value.
 * App code passes `DateInput`; the dialect decides storage.
 * - postgres: ISO-8601 string (TIMESTAMPTZ) — Bun SQL rejects JS `Date`
 *   bindings (`Date#toString()` → time zone "gmt+0500" is not recognized)
 * - others: `YYYY-MM-DD HH:mm:ss` text / DATETIME2-compatible string
 */
export function dateTimeForStorage(
  value: DateInput,
  driver: DriverName,
): Date | string {
  if (driver === "postgres") {
    return toDate(value).toISOString();
  }
  return formatDateTimeSql(value);
}

/**
 * Driver-aware date write value (`DATE` / calendar day).
 * Always stores as `YYYY-MM-DD` string (SQLite TEXT, PG DATE, MySQL DATE, SQL Server DATE).
 */
export function dateForStorage(value: DateInput): string {
  if (typeof value === "string" && YMD_RE.test(value.trim())) {
    return value.trim();
  }
  return formatDateYmd(value);
}

/** Expression that yields a calendar date for comparisons (`whereDate`). */
export function whereDateExpression(
  column: string,
  driver: DriverName,
): string {
  switch (driver) {
    case "sqlite":
      return `date(${column})`;
    case "postgres":
      return `(${column})::date`;
    case "mysql":
    case "mariadb":
      return `DATE(${column})`;
    case "sqlsrv":
      return `CAST(${column} AS DATE)`;
  }
}

export function whereYearExpression(
  column: string,
  driver: DriverName,
): string {
  switch (driver) {
    case "sqlite":
      return `cast(strftime('%Y', ${column}) as integer)`;
    case "postgres":
      return `EXTRACT(YEAR FROM ${column})`;
    case "mysql":
    case "mariadb":
    case "sqlsrv":
      return `YEAR(${column})`;
  }
}

export function whereMonthExpression(
  column: string,
  driver: DriverName,
): string {
  switch (driver) {
    case "sqlite":
      return `cast(strftime('%m', ${column}) as integer)`;
    case "postgres":
      return `EXTRACT(MONTH FROM ${column})`;
    case "mysql":
    case "mariadb":
    case "sqlsrv":
      return `MONTH(${column})`;
  }
}

export function whereDayExpression(
  column: string,
  driver: DriverName,
): string {
  switch (driver) {
    case "sqlite":
      return `cast(strftime('%d', ${column}) as integer)`;
    case "postgres":
      return `EXTRACT(DAY FROM ${column})`;
    case "mysql":
    case "mariadb":
    case "sqlsrv":
      return `DAY(${column})`;
  }
}

/** Current timestamp expression (`NOW()` / `GETDATE()` / `datetime('now')`). */
export function sqlNow(driver: DriverName): string {
  if (driver === "sqlite") return "datetime('now')";
  if (driver === "sqlsrv") return "SYSDATETIME()";
  return "NOW()";
}
