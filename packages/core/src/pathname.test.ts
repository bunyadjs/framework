import { expect, test } from "bun:test";
import { pathnameOf } from "../src/index.ts";

test("pathnameOf strips host and query", () => {
  expect(pathnameOf("http://localhost:3000/")).toBe("/");
  expect(pathnameOf("http://localhost:3000/users?x=1")).toBe("/users");
  expect(pathnameOf("http://localhost:3000/users/")).toBe("/users");
});

test("pathnameOf cache does not mix distinct URLs", () => {
  const a = "http://127.0.0.1:9/hello";
  const b = "http://127.0.0.1:9/select";
  expect(pathnameOf(a)).toBe("/hello");
  expect(pathnameOf(a)).toBe("/hello");
  expect(pathnameOf(b)).toBe("/select");
  expect(pathnameOf(a)).toBe("/hello");
});
