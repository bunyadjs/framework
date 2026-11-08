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

test("routeMayMatch is conservative: a {param} segment could be anything", async () => {
  const { handleCors } = await import("./cors.ts");
  const cors = handleCors({ paths: ["api/*", "auth/csrf-cookie"] }) as {
    appliesTo: (r: { uri: string }) => boolean;
  };
  expect(cors.appliesTo({ uri: "/api/users/{id}" })).toBe(true);
  expect(cors.appliesTo({ uri: "/api" })).toBe(true);
  expect(cors.appliesTo({ uri: "/auth/csrf-cookie" })).toBe(true);
  expect(cors.appliesTo({ uri: "/{tenant}/orders" })).toBe(true);
  expect(cors.appliesTo({ uri: "/users/{id}" })).toBe(false);
  expect(cors.appliesTo({ uri: "/" })).toBe(false);
  expect(
    (
      handleCors({ paths: [] }) as {
        appliesTo: (r: { uri: string }) => boolean;
      }
    ).appliesTo({ uri: "/api/x" }),
  ).toBe(false);
  expect(
    (
      handleCors({ paths: ["*"] }) as {
        appliesTo: (r: { uri: string }) => boolean;
      }
    ).appliesTo({ uri: "/anything" }),
  ).toBe(true);
});

// --- safe defaults, origin matching, Vary -----------------------------------------------------

import { afterEach } from "bun:test";
import {
  applyCors,
  corsPreflight,
  getCorsConfig,
  isOriginAllowed,
} from "./cors.ts";

afterEach(() => setCorsConfig(undefined));

async function run(
  method: string,
  origin: string | null,
  config?: Parameters<typeof setCorsConfig>[0],
  path = "http://localhost/api/users",
  extra: Record<string, string> = {},
) {
  if (config !== undefined) setCorsConfig(config);
  const headers: Record<string, string> = { ...extra };
  if (origin !== null) headers.Origin = origin;
  const mw = handleCors();
  return (mw as { handle: Function }).handle(
    req(method, path, headers),
    async () => new Response("ok", { status: 200 }),
  ) as Response;
}

describe("defaults", () => {
  test("with no configuration any origin is allowed on api paths, without credentials", async () => {
    setCorsConfig(undefined);
    const response = await run("GET", "https://app.test");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    // other paths are left alone
    const other = await run(
      "GET",
      "https://app.test",
      undefined,
      "http://localhost/page",
    );
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("preflight answers are not cached unless max_age is set", async () => {
    const none = await run("OPTIONS", "https://app.test", {
      allowed_origins: ["https://app.test"],
    });
    expect(none.headers.get("Access-Control-Max-Age")).toBeNull();
    const cached = await run("OPTIONS", "https://app.test", {
      allowed_origins: ["https://app.test"],
      max_age: 600,
    });
    expect(cached.headers.get("Access-Control-Max-Age")).toBe("600");
  });
});

describe("Vary: Origin", () => {
  const config = {
    allowed_origins: ["https://app.test"],
    supports_credentials: true,
  };

  test("is sent for allowed, rejected and origin-less requests, and on preflights", async () => {
    expect(
      (await run("GET", "https://app.test", config)).headers.get("Vary"),
    ).toContain("Origin");
    expect(
      (await run("GET", "https://evil.example", config)).headers.get("Vary"),
    ).toContain("Origin");
    expect((await run("GET", null, config)).headers.get("Vary")).toContain(
      "Origin",
    );
    expect(
      (await run("OPTIONS", "https://app.test", config)).headers.get("Vary"),
    ).toContain("Origin");
    const rejected = await run("OPTIONS", "https://evil.example", config);
    expect(rejected.status).toBe(403);
    expect(rejected.headers.get("Vary")).toContain("Origin");
  });

  test("a rejected origin gets no CORS headers and the body is untouched", async () => {
    const response = await run("GET", "https://evil.example", config);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(await response.text()).toBe("ok");
  });

  test("is not added for a plain wildcard, where the answer never depends on the origin", async () => {
    const response = await run("GET", "https://anyone.test", {
      allowed_origins: ["*"],
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Vary")).toBeNull();
  });

  test("existing Vary values are kept", async () => {
    setCorsConfig(config);
    const mw = handleCors() as { handle: Function };
    const response = (await mw.handle(
      req("GET", "http://localhost/api/users", { Origin: "https://app.test" }),
      async () => new Response("ok", { headers: { Vary: "Accept-Encoding" } }),
    )) as Response;
    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Origin");
  });
});

describe("origin matching", () => {
  test("host wildcards match subdomains of the same scheme, never the bare domain or look-alikes", () => {
    const config = { allowed_origins: ["https://*.example.com"] };
    for (const ok of ["https://a.example.com", "https://a.b.example.com"]) {
      expect(isOriginAllowed(ok, undefined, config)).toBe(ok);
    }
    for (const bad of [
      // a pattern without a port allows no port
      "https://x.example.com:8443",
      "https://example.com",
      "https://evil-example.com",
      "https://a.example.com.evil.com",
      "http://a.example.com",
      "https://.example.com",
      "https://a.example.com/path",
      "https://user@a.example.com",
      "null",
      "",
    ]) {
      expect(isOriginAllowed(bad, undefined, config)).toBeNull();
    }
  });

  test("a port is exact, `*` means any port or none", () => {
    const exact = { allowed_origins: ["http://localhost:3000"] };
    expect(isOriginAllowed("http://localhost:3000", undefined, exact)).toBe(
      "http://localhost:3000",
    );
    expect(
      isOriginAllowed("http://localhost:3001", undefined, exact),
    ).toBeNull();
    expect(isOriginAllowed("http://localhost", undefined, exact)).toBeNull();

    const any = {
      allowed_origins: [
        "http://localhost:*",
        "http://[::1]:*",
        "http://*.localhost:*",
      ],
    };
    for (const ok of [
      "http://localhost",
      "http://localhost:5173",
      "http://[::1]:3000",
      "http://acme.localhost:3003",
    ]) {
      expect(isOriginAllowed(ok, undefined, any)).toBe(ok);
    }
    for (const bad of [
      "http://localhost.evil.com",
      "http://evillocalhost:3000",
      "https://localhost:3000",
    ]) {
      expect(isOriginAllowed(bad, undefined, any)).toBeNull();
    }
  });

  test("exact origins and the `null` origin", () => {
    const config = {
      allowed_origins: ["https://app.test", "tauri://localhost"],
    };
    expect(isOriginAllowed("tauri://localhost", undefined, config)).toBe(
      "tauri://localhost",
    );
    expect(isOriginAllowed("https://app.test", undefined, config)).toBe(
      "https://app.test",
    );
    expect(
      isOriginAllowed("https://app.test.evil.com", undefined, config),
    ).toBeNull();
    expect(isOriginAllowed("null", undefined, config)).toBeNull();
    expect(
      isOriginAllowed("null", undefined, { allowed_origins: ["null"] }),
    ).toBe("null");
  });

  test("regex patterns still work, invalid ones are ignored", () => {
    const config = {
      allowed_origins: [],
      allowed_origins_patterns: [
        "^https://[a-z]+\\.shop\\.test$",
        "([unclosed",
      ],
    };
    expect(isOriginAllowed("https://abc.shop.test", undefined, config)).toBe(
      "https://abc.shop.test",
    );
    expect(
      isOriginAllowed("https://ab1.shop.test", undefined, config),
    ).toBeNull();
  });

  test("a callback decides when the list does not", () => {
    const config = {
      allowed_origins: ["https://app.test"],
      allowed_origins_callback: (origin: string) =>
        origin.endsWith(".trusted.test"),
    };
    expect(isOriginAllowed("https://app.test", undefined, config)).toBe(
      "https://app.test",
    );
    expect(isOriginAllowed("https://x.trusted.test", undefined, config)).toBe(
      "https://x.trusted.test",
    );
    expect(
      isOriginAllowed("https://x.evil.test", undefined, config),
    ).toBeNull();
  });

  test("a plain wildcard allows any origin and answers `*`", () => {
    expect(
      isOriginAllowed("https://anything.test", undefined, {
        allowed_origins: ["*"],
      }),
    ).toBe("*");
  });
});

describe("private network access", () => {
  test("is only answered when switched on and asked for", async () => {
    const asked = {
      Origin: "https://app.test",
      "Access-Control-Request-Private-Network": "true",
    };
    const off = await run(
      "OPTIONS",
      "https://app.test",
      { allowed_origins: ["https://app.test"] },
      undefined,
      asked,
    );
    expect(off.headers.get("Access-Control-Allow-Private-Network")).toBeNull();
    const on = await run(
      "OPTIONS",
      "https://app.test",
      { allowed_origins: ["https://app.test"], allow_private_network: true },
      undefined,
      asked,
    );
    expect(on.headers.get("Access-Control-Allow-Private-Network")).toBe("true");
  });
});

describe("programmatic use (responses built outside the middleware)", () => {
  const config = {
    allowed_origins: ["https://app.test"],
    supports_credentials: true,
    allow_private_network: true,
  };

  test("applyCors adds the headers to a response", async () => {
    const request = req("GET", "http://localhost/anything", {
      Origin: "https://app.test",
    });
    const response = applyCors(request, new Response("hi"), config);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.test",
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
    expect(response.headers.get("Vary")).toContain("Origin");
    expect(await response.text()).toBe("hi");
  });

  test("corsPreflight answers an OPTIONS request", () => {
    const request = req("OPTIONS", "http://localhost/anything", {
      Origin: "https://app.test",
      "Access-Control-Request-Method": "POST",
    });
    const response = corsPreflight(request, config);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.test",
    );
    const denied = corsPreflight(
      req("OPTIONS", "http://localhost/x", { Origin: "https://evil.test" }),
      config,
    );
    expect(denied.status).toBe(403);
  });

  test("a plain fetch Request is accepted", () => {
    const raw = new globalThis.Request("http://localhost/anything", {
      method: "OPTIONS",
      headers: { Origin: "https://app.test" },
    });
    expect(corsPreflight(raw, config).status).toBe(204);
    const response = applyCors(raw, new Response("x"), config);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.test",
    );
  });

  test("an immutable response (as returned by fetch) is copied, not mutated", async () => {
    const immutable = Response.redirect("https://app.test/next", 302);
    const request = req("GET", "http://localhost/anything", {
      Origin: "https://app.test",
    });
    const response = applyCors(request, immutable, config);
    expect(response.status).toBe(302);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.test",
    );
  });
});

describe("speed", () => {
  test("matching is compiled once: many checks against many patterns stay fast", () => {
    const patterns = Array.from(
      { length: 50 },
      (_, i) => `^https://tenant${i}\\.example\\.com$`,
    );
    const config = {
      allowed_origins: [
        "https://*.shop.test",
        "http://localhost:*",
        ...Array.from({ length: 50 }, (_, i) => `https://app${i}.test`),
      ],
      allowed_origins_patterns: patterns,
    };
    setCorsConfig(config);
    expect(getCorsConfig().allowed_origins).toContain("http://localhost:*");
    const start = performance.now();
    for (let i = 0; i < 50_000; i += 1) {
      isOriginAllowed(`https://tenant${i % 70}.example.com`, undefined, config);
      isOriginAllowed(`https://x${i % 30}.shop.test`, undefined, config);
      isOriginAllowed("https://evil.example", undefined, config);
    }
    expect(performance.now() - start).toBeLessThan(500);
  });
});
