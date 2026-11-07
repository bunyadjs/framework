import { afterEach, expect, test } from "bun:test";
import { DEFAULT_MAX_PER_PAGE, clampPerPage, getMaxPerPage, setMaxPerPage } from "./index.ts";

afterEach(() => setMaxPerPage(DEFAULT_MAX_PER_PAGE));

test("the default limit is 100", () => {
  expect(getMaxPerPage()).toBe(100);
});

test("sizes inside the limit are kept", () => {
  expect(clampPerPage(1)).toBe(1);
  expect(clampPerPage(15)).toBe(15);
  expect(clampPerPage(100)).toBe(100);
  expect(clampPerPage("25")).toBe(25);
  expect(clampPerPage(12.9)).toBe(12);
});

test("sizes over the limit are clamped, however large", () => {
  expect(clampPerPage(101)).toBe(100);
  expect(clampPerPage(1_000_000)).toBe(100);
  expect(clampPerPage(Number.MAX_SAFE_INTEGER)).toBe(100);
  expect(clampPerPage(Infinity)).toBe(100);
  expect(clampPerPage("99999999999")).toBe(100);
});

test("missing and nonsense sizes fall back; negatives become 1", () => {
  for (const bad of [undefined, null, "", "abc", NaN, 0, "0", {}, []]) {
    expect(clampPerPage(bad)).toBe(15);
  }
  expect(clampPerPage(undefined, { fallback: 50 })).toBe(50);
  expect(clampPerPage(-5)).toBe(1);
  expect(clampPerPage("-5")).toBe(1);
});

test("the limit can be changed, per call or for the application", () => {
  expect(clampPerPage(500, { limit: 20 })).toBe(20);
  expect(clampPerPage(500, { limit: Infinity })).toBe(500);
  setMaxPerPage(30);
  expect(clampPerPage(500)).toBe(30);
  expect(getMaxPerPage()).toBe(30);
});

test("a fallback larger than the limit is clamped too", () => {
  expect(clampPerPage(undefined, { fallback: 500 })).toBe(100);
});

test("an invalid limit is refused", () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity]) {
    expect(() => setMaxPerPage(bad)).toThrow(RangeError);
  }
  expect(getMaxPerPage()).toBe(100);
});
