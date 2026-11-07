import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { rememberTokenMatches } from "./guard.ts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

test("a stored digest matches the cookie value it was made from, and nothing else", () => {
  const token = "cookie-secret-value";
  const stored = digest(token);
  expect(rememberTokenMatches(stored, token)).toBe(true);
  expect(rememberTokenMatches(stored, "other")).toBe(false);
  expect(rememberTokenMatches(stored, "")).toBe(false);
});

test("a stored digest is never accepted as the cookie value itself", () => {
  // Someone who read the table must not be able to sign in with what they read.
  const stored = digest("cookie-secret-value");
  expect(rememberTokenMatches(stored, stored)).toBe(false);
  expect(rememberTokenMatches(stored, stored.toUpperCase())).toBe(false);
});

test("rows stored before digests existed still match their plaintext", () => {
  expect(rememberTokenMatches("legacy-plain-token", "legacy-plain-token")).toBe(true);
  expect(rememberTokenMatches("legacy-plain-token", "legacy-plain-tokeN")).toBe(false);
  expect(rememberTokenMatches("legacy-plain-token", "short")).toBe(false);
  expect(rememberTokenMatches("legacy-plain-token", "")).toBe(false);
});
