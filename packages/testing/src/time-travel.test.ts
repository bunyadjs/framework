import { afterEach, expect, test } from "bun:test";
import { freezeTime, travel, travelBack } from "./time-travel.ts";

afterEach(() => travelBack());

test("freezeTime accepts a Date and travel moves from it", () => {
  freezeTime(new Date("2026-01-01T00:00:00Z"));
  travel("+1 hours");
  expect(new Date().toISOString()).toBe("2026-01-01T01:00:00.000Z");
});

test("travel accepts singular and plural units", () => {
  freezeTime(0);
  travel("+1 hour");
  travel("+2 days");
  travel("-30 minutes");
  expect(Date.now()).toBe(3_600_000 + 2 * 86_400_000 - 30 * 60_000);
});

test("travel to a Date freezes at that instant", () => {
  travel(new Date("2030-05-05T00:00:00Z"));
  expect(Date.now()).toBe(Date.parse("2030-05-05T00:00:00Z"));
});

test("travelBack restores the real clock", () => {
  freezeTime(0);
  travelBack();
  expect(Date.now()).toBeGreaterThan(1_700_000_000_000);
});
