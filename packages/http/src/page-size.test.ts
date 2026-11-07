import { afterEach, expect, test } from "bun:test";
import { DEFAULT_MAX_PER_PAGE, setMaxPerPage } from "@bunyad/common";
import { Request } from "./index.ts";

const asking = (query: string): Request => new Request(new globalThis.Request(`http://localhost/items${query}`));

afterEach(() => setMaxPerPage(DEFAULT_MAX_PER_PAGE));

test("per_page and perPage are read, and clamped to the limit", () => {
  expect(asking("?per_page=25").pageSize()).toBe(25);
  expect(asking("?perPage=40").pageSize()).toBe(40);
  expect(asking("?per_page=100").pageSize()).toBe(100);
  expect(asking("?per_page=101").pageSize()).toBe(100);
  expect(asking("?per_page=99999999999").pageSize()).toBe(100);
});

test("missing, empty and nonsense values give the default; negatives give 1", () => {
  expect(asking("").pageSize()).toBe(15);
  expect(asking("?per_page=").pageSize()).toBe(15);
  expect(asking("?per_page=abc").pageSize()).toBe(15);
  expect(asking("?per_page=0").pageSize()).toBe(15);
  expect(asking("?per_page=-3").pageSize()).toBe(1);
  expect(asking("").pageSize(30)).toBe(30);
});

test("per_page wins over perPage when both are given", () => {
  expect(asking("?per_page=10&perPage=50").pageSize()).toBe(10);
});

test("the limit follows the application-wide setting, or an explicit one", () => {
  setMaxPerPage(20);
  expect(asking("?per_page=50").pageSize()).toBe(20);
  expect(asking("?per_page=50").pageSize(15, 500)).toBe(50);
});
