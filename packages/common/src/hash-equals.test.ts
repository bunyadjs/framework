import { expect, test } from "bun:test";
import { hashEquals } from "./index.ts";

test("equal strings match, different strings do not", () => {
  expect(hashEquals("secret", "secret")).toBe(true);
  expect(hashEquals("secret", "Secret")).toBe(false);
  expect(hashEquals("secret", "secre")).toBe(false);
  expect(hashEquals("secret", "secret ")).toBe(false);
});

test("strings of different length never throw and never match", () => {
  expect(hashEquals("a", "a".repeat(10_000))).toBe(false);
  expect(hashEquals("a".repeat(10_000), "a")).toBe(false);
});

test("empty strings are equal to each other only", () => {
  expect(hashEquals("", "")).toBe(true);
  expect(hashEquals("", "x")).toBe(false);
  expect(hashEquals("x", "")).toBe(false);
});

test("multi-byte text is compared by content", () => {
  expect(hashEquals("päss🔑", "päss🔑")).toBe(true);
  expect(hashEquals("päss🔑", "pass🔑")).toBe(false);
  // Same UTF-16 length, different bytes.
  expect(hashEquals("é", "é")).toBe(false);
});

test("anything that is not a string is not equal, even to itself", () => {
  expect(hashEquals(null, null)).toBe(false);
  expect(hashEquals(undefined, undefined)).toBe(false);
  expect(hashEquals(1, 1)).toBe(false);
  expect(hashEquals("1", 1)).toBe(false);
  expect(hashEquals(Buffer.from("a"), Buffer.from("a"))).toBe(false);
});

test("time does not depend on length or on how much matched", () => {
  const known = "ABCD-EFGH-IJKL";
  const cases = ["X", "XXXX-XXXX-XXXX", "ABCD-EFGH-IJKX", "A".repeat(500)];
  const time = (given: string, rounds = 200_000): number => {
    for (let i = 0; i < 20_000; i += 1) hashEquals(known, given);
    const start = performance.now();
    for (let i = 0; i < rounds; i += 1) hashEquals(known, given);
    return performance.now() - start;
  };
  const timings = cases.map((given) => time(given));
  // A length shortcut shows as one case being far quicker. Allow generous noise.
  expect(Math.max(...timings.slice(0, 3)) / Math.min(...timings.slice(0, 3))).toBeLessThan(1.6);
});
