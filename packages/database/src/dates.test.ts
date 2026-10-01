import { expect, test } from "bun:test";
import {
  dateForStorage,
  dateTimeForStorage,
  formatDateTimeSql,
  formatDateYmd,
  toDate,
} from "../src/dates.ts";

test("toDate parses YMD as UTC midnight", () => {
  const d = toDate("2026-08-08");
  expect(d.toISOString()).toBe("2026-08-08T00:00:00.000Z");
  expect(formatDateYmd(d)).toBe("2026-08-08");
});

test("toDate parses naive SQL datetime as UTC", () => {
  const d = toDate("2026-08-08 14:30:00");
  expect(d.toISOString()).toBe("2026-08-08T14:30:00.000Z");
  expect(formatDateTimeSql(d)).toBe("2026-08-08 14:30:00");
});

test("toDate accepts Date / epoch / duck-typed toDate (dayjs-shaped)", () => {
  const epoch = toDate(1_723_123_200_000);
  expect(epoch).toBeInstanceOf(Date);

  const fromDate = toDate(new Date("2026-01-15T12:00:00.000Z"));
  expect(formatDateYmd(fromDate)).toBe("2026-01-15");

  const duck = {
    toDate: () => new Date("2026-03-01T00:00:00.000Z"),
  };
  expect(formatDateYmd(duck)).toBe("2026-03-01");
  expect(dateForStorage(duck)).toBe("2026-03-01");
});

test("storage helpers are driver-consistent for the same DateInput", () => {
  const input = "2026-08-08 09:15:00";
  expect(dateForStorage(input)).toBe("2026-08-08");
  expect(dateTimeForStorage(input, "sqlite")).toBe("2026-08-08 09:15:00");
  expect(dateTimeForStorage(input, "postgres")).toBe(
    toDate(input).toISOString(),
  );
  expect(dateForStorage({ toDate: () => toDate(input) })).toBe("2026-08-08");
});
