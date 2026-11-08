import { describe, expect, test } from "bun:test";
import { Request } from "./request.ts";
import { cacheHeaders, parseCacheHeaderOptions } from "./cache-headers.ts";
import { getMiddlewareAlias } from "./middleware-alias.ts";

function req(method = "GET", headers: Record<string, string> = {}): Request {
  return new Request(
    new globalThis.Request("http://localhost/x", { method, headers }),
  );
}

async function run(
  options: Parameters<typeof cacheHeaders>[0],
  request: Request,
  response: Response,
) {
  const mw = cacheHeaders(options) as { handle: Function };
  return (await mw.handle(request, async () => response)) as Response;
}

describe("options", () => {
  test("a string is split on semicolons", () => {
    expect(parseCacheHeaderOptions("public;max_age=300;etag")).toEqual({
      public: true,
      max_age: 300,
      etag: true,
    });
    expect(parseCacheHeaderOptions("no_store")).toEqual({ no_store: true });
  });

  test("an unknown option or a bad number is refused", () => {
    expect(() => parseCacheHeaderOptions("nope")).toThrow(/unknown option/);
    expect(() => parseCacheHeaderOptions("max_age=abc")).toThrow(/number/);
  });
});

describe("Cache-Control", () => {
  test("directives are written in alphabetical order", async () => {
    const response = await run(
      "public;max_age=300;must_revalidate",
      req(),
      new Response("body"),
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "max-age=300, must-revalidate, public",
    );
  });

  test("no_store", async () => {
    const response = await run("no_store", req(), new Response("secret"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("private wins over public", async () => {
    const response = await run(
      { public: true, private: true },
      req(),
      new Response("x"),
    );
    expect(response.headers.get("Cache-Control")).toBe("private");
  });

  test("only GET and HEAD responses with a body are changed", async () => {
    expect(
      (await run("no_store", req("POST"), new Response("x"))).headers.get(
        "Cache-Control",
      ),
    ).toBeNull();
    expect(
      (
        await run("no_store", req("GET"), new Response(null, { status: 204 }))
      ).headers.get("Cache-Control"),
    ).toBeNull();
    expect(
      (await run("no_store", req("HEAD"), new Response("x"))).headers.get(
        "Cache-Control",
      ),
    ).toBe("no-store");
  });

  test("the body and status are untouched", async () => {
    const response = await run(
      "no_store",
      req(),
      new Response("hello", { status: 201 }),
    );
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("hello");
  });
});

describe("etag", () => {
  test("sends an ETag from the body, and the same body gives the same tag", async () => {
    const a = await run("etag", req(), new Response("same"));
    const b = await run("etag", req(), new Response("same"));
    const c = await run("etag", req(), new Response("different"));
    expect(a.headers.get("ETag")).toMatch(/^"[0-9a-f]{32}"$/);
    expect(a.headers.get("ETag")).toBe(b.headers.get("ETag"));
    expect(a.headers.get("ETag")).not.toBe(c.headers.get("ETag"));
    expect(await a.text()).toBe("same");
  });

  test("answers 304 with no body when the request already has the tag", async () => {
    const first = await run(
      "public;max_age=60;etag",
      req(),
      new Response("page"),
    );
    const tag = first.headers.get("ETag")!;
    const again = await run(
      "public;max_age=60;etag",
      req("GET", { "If-None-Match": tag }),
      new Response("page"),
    );
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("ETag")).toBe(tag);
    expect(again.headers.get("Cache-Control")).toBe("max-age=60, public");
  });
});

test("it is registered as the cache.headers alias", async () => {
  const factory = getMiddlewareAlias("cache.headers")!;
  const mw = factory("public;max_age=10") as { handle: Function };
  const response = (await mw.handle(
    req(),
    async () => new Response("x"),
  )) as Response;
  expect(response.headers.get("Cache-Control")).toBe("max-age=10, public");
});
