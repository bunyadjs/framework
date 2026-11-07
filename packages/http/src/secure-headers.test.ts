import { afterEach, describe, expect, test } from "bun:test";
import { Request, applySecureHeaders, secureHeaders, setTrustedProxies } from "./index.ts";

function req(url = "http://localhost/page", headers: Record<string, string> = {}): Request {
  return new Request(new globalThis.Request(url, { headers }));
}

async function through(config: Parameters<typeof secureHeaders>[0], request: Request, response: () => Response = () => new Response("ok")) {
  const mw = secureHeaders(config) as { handle: Function };
  return (await mw.handle(request, async () => response())) as Response;
}

afterEach(() => setTrustedProxies([]));

describe("the default headers", () => {
  test("every response is protected from sniffing, leaks little in the referrer and cannot be framed by another site", async () => {
    const response = await through(undefined, req());
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  test("Strict-Transport-Security is sent over https only", async () => {
    const plain = await through(undefined, req("http://localhost/"));
    expect(plain.headers.get("Strict-Transport-Security")).toBeNull();
    const secure = await through(undefined, req("https://shop.example/"));
    expect(secure.headers.get("Strict-Transport-Security")).toBe("max-age=15552000");
  });

  test("a request that reached us through a trusted proxy over https counts as secure", async () => {
    setTrustedProxies(["10.0.0.1"]);
    const request = req("http://shop.example/", { "x-forwarded-proto": "https" });
    request.setRemoteAddress("10.0.0.1");
    expect((await through(undefined, request)).headers.get("Strict-Transport-Security")).toBe("max-age=15552000");
    // a client cannot claim https for itself
    const forged = req("http://shop.example/", { "x-forwarded-proto": "https" });
    forged.setRemoteAddress("203.0.113.5");
    expect((await through(undefined, forged)).headers.get("Strict-Transport-Security")).toBeNull();
  });

  test("no Content-Security-Policy or Permissions-Policy unless configured: they depend on the pages", async () => {
    const response = await through(undefined, req());
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("Permissions-Policy")).toBeNull();
  });
});

describe("configuration", () => {
  test("each header can be changed or switched off", async () => {
    const response = await through(
      {
        referrerPolicy: "no-referrer",
        frameOptions: "DENY",
        contentSecurityPolicy: "default-src 'self'",
        permissionsPolicy: "camera=()",
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      },
      req("https://shop.example/"),
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(response.headers.get("Permissions-Policy")).toBe("camera=()");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains; preload");

    const off = await through(
      { contentTypeOptions: false, referrerPolicy: false, frameOptions: false, hsts: false },
      req("https://shop.example/"),
    );
    for (const name of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Strict-Transport-Security"]) {
      expect(off.headers.get(name), name).toBeNull();
    }
  });

  test("the api preset sends nothing a script could use and cannot be framed", async () => {
    const response = await through({ preset: "api" }, req("https://api.example/v1/x"));
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("a setting overrides its preset", async () => {
    const response = await through({ preset: "api", frameOptions: "SAMEORIGIN" }, req());
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });
});

describe("the response", () => {
  test("headers the handler set are kept", async () => {
    const response = await through(undefined, req("https://shop.example/"), () =>
      new Response("ok", {
        headers: { "X-Frame-Options": "DENY", "Content-Security-Policy": "sandbox", "Strict-Transport-Security": "max-age=1" },
      }),
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=1");
  });

  test("the response is changed in place, not copied, and its body is untouched", async () => {
    const own = new Response("body");
    const response = await through(undefined, req(), () => own);
    expect(response).toBe(own);
    expect(await response.text()).toBe("body");
  });

  test("a response that cannot be changed is copied", async () => {
    const response = await through(undefined, req(), () => Response.redirect("https://example.test/next", 302));
    expect(response.status).toBe(302);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("error responses and redirects are protected too", async () => {
    const notFound = await through(undefined, req(), () => new Response("nope", { status: 404 }));
    expect(notFound.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("programmatic use", () => {
  test("applySecureHeaders protects a response built outside the middleware stack", () => {
    const raw = new globalThis.Request("https://shop.example/file");
    const response = applySecureHeaders(raw, new Response("x"), { frameOptions: false });
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBeNull();
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=15552000");
  });
});

describe("speed", () => {
  test("adding the headers costs a few microseconds a request", async () => {
    const mw = secureHeaders() as { handle: Function };
    const request = req("https://shop.example/");
    for (let i = 0; i < 5_000; i += 1) await mw.handle(request, async () => new Response("ok"));
    const started = performance.now();
    for (let i = 0; i < 50_000; i += 1) await mw.handle(request, async () => new Response("ok"));
    expect((performance.now() - started) / 50_000).toBeLessThan(0.02); // under 20 µs, with plenty of room
  });
});
