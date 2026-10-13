/**
 * W3C Datetime (`YYYY-MM-DDThh:mm:ss+00:00`), as spatie emits via `DateTime::ATOM`.
 */

export type DateInput = Date | string | number;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Parse a `Date | ISO string | epoch ms` into a valid Date, or throw. */
export function toDate(value: DateInput): Date {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid sitemap date [${String(value)}].`);
  }
  return date;
}

/** Format as W3C Datetime in UTC with an explicit `+00:00` offset. */
export function toW3cDate(value: DateInput): string {
  const d = toDate(value);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  );
}
