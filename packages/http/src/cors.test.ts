import { describe, expect, test } from "bun:test";
import { Request } from "./request.ts";
import { handleCors, setCorsConfig } from "./cors.ts";

function req(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(new globalThis.Request(url, { method, headers }));
}

describe("handleCors", () => {
  test("answers OPTIONS preflight for matching paths", async () => {
    setCorsConfig({
      paths: ["api/*"],
      allowed_origins: ["https://app.test"],
      allowed_methods: ["*"],
      allowed_headers: ["*"],
      max_age: 600,
    });
    const mw = handleCors();
    const response = await (mw as { handle: Function }).handle(
      req("OPTIONS", "http://localhost/api/users", {
        Origin: "https://app.test",
        "Access-Control-Request-Headers": "Content-Type, X-Token",
      }),
      async () => new Response("should not run"),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.test",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "Content-Type",
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
  });

  test("adds CORS headers on normal responses", async () => {
    setCorsConfig({
      paths: ["api/*"],
      allowed_origins: ["*"],
    });
    const mw = handleCors();
    const response = await (mw as { handle: Function }).handle(
      req("GET", "http://localhost/api/users", {
        Origin: "https://app.test",
      }),
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("skips non-matching paths", async () => {
    setCorsConfig({ paths: ["api/*"] });
    const mw = handleCors();
    const response = await (mw as { handle: Function }).handle(
      req("GET", "http://localhost/home", { Origin: "https://app.test" }),
      async () => new Response("home"),
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await response.text()).toBe("home");
  });
});
