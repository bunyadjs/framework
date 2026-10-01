import { afterEach, expect, test } from "bun:test";
import { runWithPaginatorRequest } from "@bunyad/common";
import {
  AbstractPaginator,
  LengthAwarePaginator,
  Paginator,
  resolvePaginatorPage,
} from "./paginator.ts";

afterEach(() => {
  AbstractPaginator.currentPathResolver(null);
  AbstractPaginator.currentPageResolver(null);
  AbstractPaginator.queryStringResolver(null);
});

test("links stay empty when no path or current request is bound", () => {
  const page = new LengthAwarePaginator([{ id: 1 }], 20, 10, 1);
  expect(page.links()).toEqual({
    first: null,
    last: null,
    prev: null,
    next: null,
  });
  expect(page.meta().path).toBe("");
});

test("explicit path wins over the current-path resolver", () => {
  AbstractPaginator.currentPathResolver(() => "http://ignored.example/units");
  const page = new LengthAwarePaginator([{ id: 1 }], 20, 10, 1, {
    path: "/items",
  });
  expect(page.links().next).toBe("/items?page=2");
  expect(page.links().last).toBe("/items?page=2");
});

test("currentPathResolver fills paginator links", () => {
  AbstractPaginator.currentPathResolver(
    () => "http://127.0.0.1:3003/api/v1/units",
  );
  const page = new LengthAwarePaginator([{ id: 1 }], 25, 10, 2);
  expect(page.links()).toEqual({
    first: "http://127.0.0.1:3003/api/v1/units?page=1",
    last: "http://127.0.0.1:3003/api/v1/units?page=3",
    prev: "http://127.0.0.1:3003/api/v1/units?page=1",
    next: "http://127.0.0.1:3003/api/v1/units?page=3",
  });
  expect(page.meta().path).toBe("http://127.0.0.1:3003/api/v1/units");
});

test("Paginator.currentPathResolver is the same static API", () => {
  Paginator.currentPathResolver(() => "/users");
  const page = new Paginator([{ id: 1 }, { id: 2 }, { id: 3 }], 2, 1);
  expect(page.links().next).toBe("/users?page=2");
});

test("bound request fills path when no resolver is registered", () => {
  const page = runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/api/v1/units",
      query: () => ({ search: "kg", page: "2" }),
      input: (key) => (key === "page" ? "2" : undefined),
    },
    () => new LengthAwarePaginator([{ id: 1 }], 25, 10, 2),
  );
  expect(page.links().first).toBe("http://localhost/api/v1/units?page=1");
  expect(page.links().next).toBe("http://localhost/api/v1/units?page=3");
});

test("withQueryString appends request query except the page name", () => {
  const page = runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/api/v1/units",
      query: () => ({ search: "kg", perPage: "10", page: "2" }),
      input: () => undefined,
    },
    () =>
      new LengthAwarePaginator([{ id: 1 }], 25, 10, 2).withQueryString(),
  );
  expect(page.links().next).toBe(
    "http://localhost/api/v1/units?search=kg&perPage=10&page=3",
  );
});

test("withPath overrides the resolved request path", () => {
  const page = runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/api/v1/units",
      query: () => ({}),
      input: () => undefined,
    },
    () =>
      new LengthAwarePaginator([{ id: 1 }], 20, 10, 1).withPath("/admin/units"),
  );
  expect(page.links().next).toBe("/admin/units?page=2");
});

test("resolveCurrentPage reads the bound request", () => {
  const page = runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/users",
      query: () => ({ page: "4" }),
      input: (key) => (key === "page" ? "4" : undefined),
    },
    () => AbstractPaginator.resolveCurrentPage(),
  );
  expect(page).toBe(4);
});

test("resolvePaginatorPage uses the request when page is omitted", () => {
  const page = runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/users",
      query: () => ({ page: "3" }),
      input: (key) => (key === "page" ? "3" : undefined),
    },
    () => resolvePaginatorPage(undefined),
  );
  expect(page).toBe(3);
});

test("resolvePaginatorPage keeps an explicit page argument", () => {
  const page = runWithPaginatorRequest(
    {
      urlWithoutQuery: () => "http://localhost/users",
      query: () => ({ page: "9" }),
      input: (key) => (key === "page" ? "9" : undefined),
    },
    () => resolvePaginatorPage(2),
  );
  expect(page).toBe(2);
});

test("resolvePaginatorPage defaults to 1 with no request", () => {
  expect(resolvePaginatorPage()).toBe(1);
});
