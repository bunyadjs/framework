import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Request } from "@bunyad/http";
import { ViewFactory, setViewFactory } from "@bunyad/view";
import {
  Inertia,
  Middleware,
  encodePageJson,
  handleInertiaRequests,
  inertia,
  resetInertiaState,
  resolveInertiaResponse,
} from "./index.ts";

function req(
  url: string,
  init: RequestInit & {
    inertia?: boolean;
    version?: string;
    partial?: string;
    except?: string;
    component?: string;
    html?: boolean;
  } = {},
): Request {
  const headers = new Headers(init.headers);
  if (init.inertia) headers.set("X-Inertia", "true");
  if (init.version != null) headers.set("X-Inertia-Version", init.version);
  if (init.partial) headers.set("X-Inertia-Partial-Data", init.partial);
  if (init.except) headers.set("X-Inertia-Partial-Except", init.except);
  if (init.component) headers.set("X-Inertia-Partial-Component", init.component);
  if (init.html) headers.set("Accept", "text/html");
  return new Request(new globalThis.Request(url, { ...init, headers }));
}

afterEach(() => {
  resetInertiaState();
});

describe("Inertia.render", () => {
  test("returns HTML document on first visit", async () => {
    Inertia.version("v1");
    const response = await Inertia.render("Home", { title: "Hi" }).toResponse(
      req("http://localhost/"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain('id="app"');
    expect(html).toContain('data-page="app"');
    expect(html).toContain('type="application/json"');
    expect(html).toContain("Home");
    expect(html).toContain("Hi");
  });

  test("returns JSON page object for X-Inertia requests", async () => {
    Inertia.version("abc");
    Inertia.share("appName", "Bunyad");
    const response = await Inertia.render("Users/Index", {
      users: [{ id: 1 }],
    }).toResponse(req("http://localhost/users", { inertia: true }));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Inertia")).toBe("true");
    expect(response.headers.get("X-Inertia-Version")).toBe("abc");
    const page = (await response.json()) as any;
    expect(page.component).toBe("Users/Index");
    expect(page.version).toBe("abc");
    expect(page.url).toBe("/users");
    expect(page.props).toEqual({
      appName: "Bunyad",
      users: [{ id: 1 }],
    });
  });

  test("uses root view when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-inertia-"));
    await writeFile(
      join(dir, "app.view"),
      `<html><body><script data-page="app" type="application/json">{!! pageJson !!}</script><div id="app"></div></body></html>`,
    );
    setViewFactory(new ViewFactory(dir));
    Inertia.setRootView("app");

    const response = await Inertia.render("Dashboard", { ok: true }).toResponse(
      req("http://localhost/dashboard"),
    );
    const html = await response.text();
    expect(html).toContain("Dashboard");
    expect(html).toContain('"ok":true');
    expect(html).toContain('data-page="app"');
    expect(html).toContain('type="application/json"');
  });

  test("inertia() helper matches Inertia.render", async () => {
    const a = await Inertia.render("A", { x: 1 }).toResponse(
      req("http://localhost/", { inertia: true }),
    );
    const b = await inertia("A", { x: 1 }).toResponse(
      req("http://localhost/", { inertia: true }),
    );
    expect((await a.json()) as any).toEqual((await b.json()) as any);
  });

  test("with() merges props onto the response", async () => {
    const page = await Inertia.render("Home", { a: 1 })
      .with("b", 2)
      .with({ c: 3 })
      .toResponse(req("http://localhost/", { inertia: true }));
    expect(((await page.json()) as any).props).toEqual({ a: 1, b: 2, c: 3 });
  });

  test("resolveInertiaResponse unwraps InertiaResponse", async () => {
    const raw = await resolveInertiaResponse(
      Inertia.render("Home", { ok: true }),
      req("http://localhost/", { inertia: true }),
    );
    expect(raw.headers.get("X-Inertia")).toBe("true");
    expect(((await raw.json()) as any).props.ok).toBe(true);

    const passthrough = await resolveInertiaResponse(
      new Response("ok"),
      req("http://localhost/"),
    );
    expect(await passthrough.text()).toBe("ok");
  });
});

describe("shared / lazy / always / defer / optional", () => {
  test("share closures receive the request", async () => {
    Inertia.share("path", (r) => new URL(r.url).pathname);
    const response = await Inertia.render("X").toResponse(
      req("http://localhost/shared", { inertia: true }),
    );
    const page = (await response.json()) as any;
    expect(page.props.path).toBe("/shared");
  });

  test("share object form, getShared, and flushShared", async () => {
    Inertia.share({ appName: "Bunyad", locale: "en" });
    expect(Inertia.getShared("appName")).toBe("Bunyad");
    expect(Inertia.getShared()).toEqual({ appName: "Bunyad", locale: "en" });
    Inertia.flushShared();
    expect(Inertia.getShared()).toEqual({});
    const page = await Inertia.render("X").toResponse(
      req("http://localhost/", { inertia: true }),
    );
    expect(((await page.json()) as any).props).toEqual({});
  });

  test("lazy props omitted on full visit, included on partial", async () => {
    const pageFull = await Inertia.render("Users", {
      users: [{ id: 1 }],
      stats: Inertia.lazy(() => ({ count: 10 })),
    }).toResponse(req("http://localhost/users", { inertia: true }));
    expect(((await pageFull.json()) as any).props).toEqual({ users: [{ id: 1 }] });

    const pagePartial = await Inertia.render("Users", {
      users: [{ id: 1 }],
      stats: Inertia.lazy(() => ({ count: 10 })),
    }).toResponse(
      req("http://localhost/users", {
        inertia: true,
        partial: "stats",
        component: "Users",
      }),
    );
    expect(((await pagePartial.json()) as any).props).toEqual({ stats: { count: 10 } });
  });

  test("optional props match lazy omit/include semantics", async () => {
    const full = await Inertia.render("Users", {
      users: [1],
      meta: Inertia.optional(() => ({ role: "admin" })),
    }).toResponse(req("http://localhost/users", { inertia: true }));
    expect(((await full.json()) as any).props).toEqual({ users: [1] });

    const partial = await Inertia.render("Users", {
      users: [1],
      meta: Inertia.optional(() => ({ role: "admin" })),
    }).toResponse(
      req("http://localhost/users", {
        inertia: true,
        partial: "meta",
        component: "Users",
      }),
    );
    expect(((await partial.json()) as any).props).toEqual({ meta: { role: "admin" } });
  });

  test("always props included on full visit and partial reloads", async () => {
    const full = await Inertia.render("Users", {
      users: [1],
      flash: Inertia.always(() => ({ ok: true })),
    }).toResponse(req("http://localhost/users", { inertia: true }));
    expect(((await full.json()) as any).props).toEqual({
      users: [1],
      flash: { ok: true },
    });

    const partial = await Inertia.render("Users", {
      users: Inertia.lazy(() => [1]),
      flash: Inertia.always(() => ({ ok: true })),
    }).toResponse(
      req("http://localhost/users", {
        inertia: true,
        partial: "users",
        component: "Users",
      }),
    );
    expect(((await partial.json()) as any).props).toEqual({
      users: [1],
      flash: { ok: true },
    });
  });

  test("defer props listed in deferredProps on full visit", async () => {
    const response = await Inertia.render("Users", {
      users: [1],
      posts: Inertia.defer(() => [{ id: 2 }]),
      comments: Inertia.defer(() => [{ id: 3 }], "sidebar"),
    }).toResponse(req("http://localhost/users", { inertia: true }));
    const page = (await response.json()) as any;
    expect(page.props).toEqual({ users: [1] });
    expect(page.deferredProps).toEqual({
      default: ["posts"],
      sidebar: ["comments"],
    });
  });

  test("defer props resolve on partial reload for requested keys", async () => {
    const response = await Inertia.render("Users", {
      users: [1],
      posts: Inertia.defer(() => [{ id: 2 }]),
    }).toResponse(
      req("http://localhost/users", {
        inertia: true,
        partial: "posts",
        component: "Users",
      }),
    );
    const page = (await response.json()) as any;
    expect(page.props).toEqual({ posts: [{ id: 2 }] });
    expect(page.deferredProps).toBeUndefined();
  });

  test("partial except omits listed props but keeps always", async () => {
    const response = await Inertia.render("Users", {
      users: [1],
      secret: "x",
      flash: Inertia.always(() => ({ ok: true })),
    }).toResponse(
      req("http://localhost/users", {
        inertia: true,
        except: "secret",
        component: "Users",
      }),
    );
    expect(((await response.json()) as any).props).toEqual({
      users: [1],
      flash: { ok: true },
    });
  });

  test("plain function props resolve on full visit", async () => {
    const page = await Inertia.render("X", {
      now: () => 42,
    }).toResponse(req("http://localhost/", { inertia: true }));
    expect(((await page.json()) as any).props.now).toBe(42);
  });
});

describe("location and middleware", () => {
  test("Inertia.location returns 409 with X-Inertia-Location", () => {
    const response = Inertia.location("https://example.com/login");
    expect(response.status).toBe(409);
    expect(response.headers.get("X-Inertia-Location")).toBe(
      "https://example.com/login",
    );
  });

  test("version mismatch returns 409 location", async () => {
    const mw = handleInertiaRequests({ version: "server-v2" });
    const response = await mw.handle(
      req("http://localhost/users", { inertia: true, version: "old" }),
      async () => new Response("should not run"),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("X-Inertia-Location")).toContain("/users");
  });

  test("middleware converts PUT 302 to 303 for Inertia", async () => {
    const mw = handleInertiaRequests({ version: "1" });
    const response = await mw.handle(
      req("http://localhost/items/1", {
        method: "PUT",
        inertia: true,
        version: "1",
      }),
      async () =>
        new Response(null, { status: 302, headers: { Location: "/items/1" } }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/items/1");
  });

  test("HandleInertiaRequests-style subclass share and version", async () => {
    class HandleInertiaRequests extends Middleware {
      protected override rootViewName = "app";
      override version() {
        return "v9";
      }
      override share() {
        return { locale: "en" };
      }
    }
    const mw = new HandleInertiaRequests();
    await mw.handle(req("http://localhost/", { html: true }), async () => {
      const response = await Inertia.render("Home").toResponse(
        req("http://localhost/", { inertia: true }),
      );
      const page = (await response.json()) as any;
      expect(page.props.locale).toBe("en");
      expect(page.version).toBe("v9");
      return response;
    });
  });

  test("flashed validation errors are shared as first messages", async () => {
    const { resolveValidationErrors } = await import("./index.ts");
    const request = req("http://localhost/", { inertia: true });
    const flashed: Record<string, unknown> = {
      email: ["Required.", "Invalid."],
      userDeletion: { password: ["Wrong password."] },
    };
    request.session = { get: (key: string) => (key === "errors" ? flashed : undefined) } as never;
    expect(resolveValidationErrors(request)).toEqual({
      email: "Required.",
      userDeletion: { password: "Wrong password." },
    });

    const named = req("http://localhost/", { inertia: true, headers: { "x-inertia-error-bag": "login" } });
    named.session = { get: () => ({ email: ["Required."] }) } as never;
    expect(resolveValidationErrors(named)).toEqual({ login: { email: "Required." } });
  });

  test("shared props stay with their own request when requests overlap", async () => {
    class HandleInertiaRequests extends Middleware {
      override async share(request: Request) {
        return { user: request.header("x-user") };
      }
    }
    const mw = new HandleInertiaRequests();
    let releaseAda!: () => void;
    const adaWaits = new Promise<void>((resolve) => (releaseAda = resolve));

    const visit = (user: string, pause: Promise<void> | null) => {
      const request = req("http://localhost/", { inertia: true, headers: { "x-user": user } });
      return mw.handle(request, async () => {
        // Ada's page renders only after Grace's request has shared its user.
        if (pause) await pause;
        return Inertia.render("Dashboard").toResponse(request);
      });
    };

    const ada = visit("ada", adaWaits);
    const grace = await visit("grace", null);
    releaseAda();

    expect(((await (await ada).json()) as any).props.user).toBe("ada");
    expect(((await grace.json()) as any).props.user).toBe("grace");
    expect(Inertia.getShared("user")).toBeUndefined();
  });

  test("middleware skips share/version work for non-HTML JSON (perf)", async () => {
    let shareCalls = 0;
    class HandleInertiaRequests extends Middleware {
      override share() {
        shareCalls += 1;
        return { locale: "en" };
      }
    }
    const mw = new HandleInertiaRequests();
    const response = await mw.handle(
      req("http://localhost/api", {
        headers: { Accept: "application/json" },
      }),
      async () => Response.json({ ok: true }),
    );
    expect(shareCalls).toBe(0);
    expect(response.headers.get("Vary")).toBe("X-Inertia");
    expect((await response.json()) as any).toEqual({ ok: true });
  });

  test("external redirect becomes Inertia.location for X-Inertia", async () => {
    const mw = handleInertiaRequests({ version: "1" });
    const response = await mw.handle(
      req("http://localhost/leave", { inertia: true, version: "1" }),
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://other.example/away" },
        }),
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("X-Inertia-Location")).toBe(
      "https://other.example/away",
    );
  });
});

test("encodePageJson escapes HTML-sensitive characters", () => {
  const json = encodePageJson({
    component: "X",
    props: { html: "<script>" },
    url: "/",
    version: null,
  });
  expect(json).not.toContain("<");
  expect(json).toContain("\\u003c");
});
