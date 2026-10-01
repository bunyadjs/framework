import { afterEach, expect, test } from "bun:test";
import {
  HttpException,
  HttpResponseException,
  Request,
  json,
} from "@bunyad/http";
import {
  Router,
  Route,
  route,
  setActiveRouter,
  getActiveRouter,
} from "../src/index.ts";

afterEach(() => {
  setActiveRouter(Route);
});

class PostsController {
  index() {
    return json([]);
  }
  create() {
    return json({});
  }
  store() {
    return json({});
  }
  show() {
    return json({});
  }
  edit() {
    return json({});
  }
  update() {
    return json({});
  }
  destroy() {
    return json({});
  }
}

test("matches get route and params", async () => {
  const r = new Router();
  r.get("/users/{id}", async (req) => json({ id: req.route("id") })).name(
    "users.show",
  );

  const hit = r.match("GET", "/users/9");
  expect(hit?.params.id).toBe("9");
  expect(r.route("users.show", { id: 9 })).toBe("/users/9");
});

test("optional trailing {name?} matches with and without the segment", () => {
  const r = new Router();
  r.get("/users/{id}/{name?}", async (req) =>
    json({ id: req.route("id"), name: req.route("name") }),
  ).name("users.optional");

  const withName = r.match("GET", "/users/9/ada");
  expect(withName?.params).toEqual({ id: "9", name: "ada" });

  const withoutName = r.match("GET", "/users/9");
  expect(withoutName?.params).toEqual({ id: "9" });
  expect(withoutName?.params.name).toBeUndefined();

  expect(r.route("users.optional", { id: 9 })).toBe("/users/9");
  expect(r.route("users.optional", { id: 9, name: "ada" })).toBe(
    "/users/9/ada",
  );

  expect(() =>
    r.get("/users/{name?}/{id}", async () => json({})),
  ).toThrow(/last URI segment|trailing/);
});

test("group prefix and name", () => {
  const r = new Router();
  r.prefix("admin")
    .name("admin.")
    .group(() => {
      r.get("/dashboard", async () => json({ ok: true })).name("dashboard");
    });

  expect(r.match("GET", "/admin/dashboard")).toBeDefined();
  expect(r.route("admin.dashboard")).toBe("/admin/dashboard");
});

test("a controller class calls __invoke", () => {
  class ShowPurchasePdf {
    __invoke() {
      return json({ pdf: true });
    }
  }

  const r = new Router();
  r.get("/purchases/{id}/purchase-pdf", ShowPurchasePdf).name("purchases.pdf");

  const hit = r.match("GET", "/purchases/4/purchase-pdf");
  expect(hit?.route.action).toEqual([ShowPurchasePdf, "__invoke"]);
});

test("a controller class without __invoke must name the action", () => {
  const r = new Router();
  expect(() => r.get("/posts", PostsController)).toThrow(/missing __invoke/);
});

test("resource registers rest routes", () => {
  const r = new Router();
  r.resource("posts", PostsController);
  expect(r.match("GET", "/posts")).toBeDefined();
  expect(r.match("GET", "/posts/1")?.params.post).toBe("1");
  expect(r.route("posts.show", { post: 1 })).toBe("/posts/1");
});

test("duplicate route names fail", () => {
  const r = new Router();
  r.get("/a", async () => json(1)).name("dup");
  expect(() => r.get("/b", async () => json(2)).name("dup")).toThrow();
});

test("model binding resolves or 404s", async () => {
  const r = new Router();
  const users = new Map([["1", { id: 1, name: "Ada" }]]);
  r.model("user", {
    find: (id) => users.get(String(id)) ?? null,
  });
  r.get("/users/{user}", async (req) => json(req.model("user"))).name(
    "users.show",
  );

  const hit = r.match("GET", "/users/1")!;
  const req = new Request(
    new globalThis.Request("http://localhost/users/1"),
    hit.params,
  );
  await r.resolveBindings(req);
  expect(req.model<{ id: number; name: string }>("user")).toEqual({ id: 1, name: "Ada" });

  r.match("GET", "/users/9");
  const missing = new Request(
    new globalThis.Request("http://localhost/users/9"),
    { user: "9" },
  );
  expect(() => r.resolveBindings(missing)).toThrow(HttpException);
});

test("custom binding field {user:remember_token} resolves and 404s", async () => {
  const r = new Router();
  const byToken = new Map([["tok-ada", { id: 1, remember_token: "tok-ada" }]]);
  r.model("user", {
    find: () => null,
    resolveRouteBinding: (value, field) => {
      expect(field).toBe("remember_token");
      return byToken.get(String(value)) ?? null;
    },
  });
  r.get("/users/{user:remember_token}", async (req) =>
    json(req.model("user")),
  );

  expect(r.routes[0]!.paramNames).toEqual(["user"]);
  expect(r.routes[0]!.bindingFields).toEqual({ user: "remember_token" });

  const hit = r.match("GET", "/users/tok-ada")!;
  expect(hit.params).toEqual({ user: "tok-ada" });
  const req = new Request(
    new globalThis.Request("http://localhost/users/tok-ada"),
    hit.params,
  );
  await r.resolveBindings(req);
  expect(req.model<{ id: number; remember_token: string }>("user")).toEqual({ id: 1, remember_token: "tok-ada" });

  r.match("GET", "/users/missing");
  const missing = new Request(
    new globalThis.Request("http://localhost/users/missing"),
    { user: "missing" },
  );
  expect(() => r.resolveBindings(missing)).toThrow(HttpException);
});

test("where constraints reject non-matching params", () => {
  const r = new Router();
  r.get("/users/{id}", async () => json({}))
    .whereNumber("id")
    .name("users.show");

  expect(r.match("GET", "/users/9")?.params.id).toBe("9");
  expect(r.match("GET", "/users/abc")).toBeUndefined();
});

test("whereIn constrains to an allow-list", () => {
  const r = new Router();
  r.get("/posts/{status}", async () => json({}))
    .whereIn("status", ["draft", "live"])
    .name("posts.status");

  expect(r.match("GET", "/posts/draft")?.params.status).toBe("draft");
  expect(r.match("GET", "/posts/live")?.params.status).toBe("live");
  expect(r.match("GET", "/posts/archived")).toBeUndefined();
});

test("currentRouteAction reports controller or Closure", () => {
  class PostsController {
    show() {
      return json({});
    }
  }
  const r = new Router();
  r.get("/posts/{id}", [PostsController, "show"]).name("posts.show");
  r.get("/about", async () => json({})).name("about");

  r.match("GET", "/posts/1");
  expect(r.currentRouteAction()).toBe("PostsController@show");
  r.match("GET", "/about");
  expect(r.currentRouteAction()).toBe("Closure");
});

test("Route.view named template uses setRouteViewRenderer", async () => {
  const { setRouteViewRenderer } = await import("../src/router.ts");
  setRouteViewRenderer(async (name, data, status = 200) =>
    new Response(`view:${name}:${JSON.stringify(data ?? {})}`, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  );
  const r = new Router();
  r.view("/welcome", "welcome", { name: "Ada" });
  const hit = r.match("GET", "/welcome");
  expect(hit).toBeDefined();
  const action = hit!.route.action as (req: Request) => Promise<Response>;
  const res = await action(
    new Request(new globalThis.Request("http://localhost/welcome")),
  );
  expect(await res.text()).toBe('view:welcome:{"name":"Ada"}');
  setRouteViewRenderer(null);
});

test("whereUlid accepts Crockford ULID and rejects garbage", () => {
  const r = new Router();
  r.get("/things/{ulid}", async () => json({}))
    .whereUlid("ulid")
    .name("things.show");

  const sample = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  expect(r.match("GET", `/things/${sample}`)?.params.ulid).toBe(sample);
  expect(r.match("GET", "/things/not-a-ulid")).toBeUndefined();
  expect(r.match("GET", "/things/01ARZ3NDEKTSV4RRFFQ69G5FA")).toBeUndefined(); // 25 chars
});

test("pattern applies globally", () => {
  const r = new Router();
  r.pattern("id", "[0-9]+");
  r.get("/items/{id}", async () => json({})).name("items.show");
  expect(r.match("GET", "/items/3")).toBeDefined();
  expect(r.match("GET", "/items/x")).toBeUndefined();
});

test("apiResource omits create and edit", () => {
  const r = new Router();
  r.apiResource("posts", PostsController);
  expect(r.match("GET", "/posts")).toBeDefined();
  expect(r.namedRoutes().has("posts.create")).toBe(false);
  expect(r.namedRoutes().has("posts.edit")).toBe(false);
  expect(r.namedRoutes().has("posts.show")).toBe(true);
  expect(r.match("GET", "/posts/1")?.params.post).toBe("1");
  expect(r.route("posts.store")).toBe("/posts");
});

test("fallback matches when nothing else does", async () => {
  const r = new Router();
  r.get("/known", async () => json({ ok: true }));
  r.fallback(async () => json({ fallback: true }));

  expect(r.match("GET", "/known")).toBeDefined();
  const hit = r.match("GET", "/missing-page");
  expect(hit).toBeDefined();
  const req = new Request(new globalThis.Request("http://localhost/missing"));
  const action = hit!.route.action;
  if (typeof action !== "function") throw new Error("expected closure");
  const res = (await action(req)) as Response;
  expect(await res.json()).toEqual({ fallback: true });
});

test("Url signed and temporarySignedRoute", async () => {
  const { Route, Url, signed } = await import("../src/index.ts");
  Route.clear();
  Url.setKey("test-secret-key");
  Route.get("/unsubscribe/{user}", async () => json({ ok: true }))
    .name("unsubscribe")
    .middleware(signed());

  const url = Url.temporarySignedRoute("unsubscribe", 10, { user: 1 });
  expect(url).toMatch(/^https?:\/\//);
  expect(url).toContain("/unsubscribe/1?");
  expect(url).toContain("expires=");
  expect(url).toContain("signature=");

  const req = new Request(new globalThis.Request(url));
  expect(Url.hasValidSignature(req)).toBe(true);
  expect(req.hasValidSignature()).toBe(true);

  const relative = Url.temporarySignedRoute(
    "unsubscribe",
    10,
    { user: 1 },
    false,
  );
  expect(relative.startsWith("/")).toBe(true);
  expect(
    Url.hasValidSignature(
      new Request(new globalThis.Request(`http://localhost${relative}`)),
    ),
  ).toBe(true);

  const withPage = `${relative}&page=2`;
  const ignoreReq = new Request(
    new globalThis.Request(`http://localhost${withPage}`),
  );
  expect(Url.hasValidSignature(ignoreReq)).toBe(false);
  expect(Url.hasValidSignatureWhileIgnoring(ignoreReq, ["page"])).toBe(true);
  expect(ignoreReq.hasValidSignatureWhileIgnoring(["page"], false)).toBe(true);

  const bad = new Request(
    new globalThis.Request(`http://localhost/unsubscribe/1?signature=deadbeef`),
  );
  expect(Url.hasValidSignature(bad)).toBe(false);

  const expired = Url.temporarySignedRoute(
    "unsubscribe",
    new Date(Date.now() - 60_000),
    { user: 1 },
  );
  const expiredReq = new Request(new globalThis.Request(expired));
  expect(Url.hasValidSignature(expiredReq)).toBe(false);

  Route.clear();
});

test("optimize uses radix matcher for static and dynamic routes", () => {
  const r = new Router();
  r.get("/", async () => json({ home: true }));
  r.get("/users/{id}", async () => json({}))
    .whereNumber("id")
    .name("users.show");
  r.get("/posts/{slug}", async () => json({})).name("posts.show");
  r.fallback(async () => json({ missing: true }));
  r.optimize();

  expect(r.match("GET", "/")?.route.uri).toBe("/");
  expect(r.match("GET", "/users/42")?.params.id).toBe("42");
  expect(r.match("GET", "/users/abc")?.route.uri).toBe("/{fallback}");
  expect(r.match("GET", "/posts/hello")?.params.slug).toBe("hello");
  expect(r.match("GET", "/nope")?.route.uri).toBe("/{fallback}");
});

test("optimize respects where constraints after recompile", () => {
  const r = new Router();
  const reg = r.get("/items/{id}", async () => json({}));
  r.optimize();
  expect(r.match("GET", "/items/abc")?.params.id).toBe("abc");
  reg.whereNumber("id");
  expect(r.match("GET", "/items/abc")).toBeUndefined();
  expect(r.match("GET", "/items/7")?.params.id).toBe("7");
});

test("domain group matches host and prefers domain routes", () => {
  const r = new Router();
  r.get("/", async () => json({ where: "web" })).name("web.home");
  r.domain("api.example.com").group(() => {
    r.get("/", async () => json({ where: "api" })).name("api.home");
    r.get("/users/{id}", async () => json({})).name("api.users");
  });
  r.domain("{account}.app.test").group(() => {
    r.get("/dashboard", async () => json({})).name("tenant.dash");
  });

  expect(r.match("GET", "/", "api.example.com")?.route.name).toBe("api.home");
  expect(r.match("GET", "/")?.route.name).toBe("web.home");
  expect(r.match("GET", "/", "www.example.com")?.route.name).toBe("web.home");
  expect(r.match("GET", "/users/1", "api.example.com")?.params.id).toBe("1");
  expect(r.match("GET", "/users/1")).toBeUndefined();
  expect(r.match("GET", "/dashboard", "acme.app.test")?.route.name).toBe(
    "tenant.dash",
  );
});

test("match registers multiple verbs; redirect/view helpers", async () => {
  const r = new Router();
  r.match(["GET", "POST"], "/form", async () => json({ ok: true })).name(
    "form",
  );
  r.redirect("/old", "/new", 302).name("old");
  r.view("/hello", async () => "<h1>Hi</h1>").name("hello");

  expect(r.match("GET", "/form")?.route.name).toBe("form");
  expect(r.match("POST", "/form")?.route.name).toBe("form");
  expect(r.has("form")).toBe(true);
  expect(r.has("missing")).toBe(false);

  const redirectHit = r.match("GET", "/old");
  expect(redirectHit).toBeTruthy();
  const redirectAction = redirectHit!.route.action;
  expect(typeof redirectAction).toBe("function");
  const res = await (redirectAction as (req: Request) => Response)(
    new Request(new globalThis.Request("http://localhost/old")),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("/new");

  const viewHit = r.match("GET", "/hello");
  const viewRes = await (
    viewHit!.route.action as (req: Request) => Promise<Response>
  )(new Request(new globalThis.Request("http://localhost/hello")));
  expect(await viewRes.text()).toBe("<h1>Hi</h1>");
});

test("current route helpers and resources map", () => {
  const r = new Router();
  r.resources({ posts: PostsController });
  r.get("/about", async () => json({})).name("about");

  expect(r.getRoutes().some((route) => route.name === "posts.index")).toBe(
    true,
  );
  r.match("GET", "/about");
  expect(r.currentRouteName()).toBe("about");
  expect(r.currentRouteNamed("about")).toBe(true);
  expect(r.is("ab*")).toBe(true);
  expect(r.is("home")).toBe(false);
});

test("setActiveRouter makes route() use the application router", () => {
  const previous = getActiveRouter();
  try {
    const appRouter = new Router();
    appRouter.get("/dashboard", async () => json({})).name("dashboard");
    expect(() => Route.route("dashboard")).toThrow();

    setActiveRouter(appRouter);
    expect(getActiveRouter()).toBe(appRouter);
    expect(route("dashboard")).toBe("/dashboard");
    expect(route("dashboard", {}, true)).toBe("http://localhost/dashboard");
  } finally {
    setActiveRouter(previous);
  }
});

test("domain captures merge into route params", () => {
  const r = new Router();
  r.domain("{account}.app.test").group(() => {
    r.get("/dashboard", async () => json({})).name("tenant.dash");
    r.get("/widgets/{id}", async () => json({})).name("tenant.widgets");
  });

  const dash = r.match("GET", "/dashboard", "acme.app.test");
  expect(dash?.route.name).toBe("tenant.dash");
  expect(dash?.params.account).toBe("acme");

  const widget = r.match("GET", "/widgets/9", "beta.app.test");
  expect(widget?.params).toEqual({ account: "beta", id: "9" });
  expect(r.match("GET", "/dashboard", "nope.example.com")).toBeUndefined();
});

test("resource only/except/names/parameters options", () => {
  const r = new Router();
  r.resource("posts", PostsController, {
    only: ["index", "show", "destroy"],
    names: { show: "posts.view" },
    parameters: { posts: "article" },
  });

  expect(r.namedRoutes().has("posts.index")).toBe(true);
  expect(r.namedRoutes().has("posts.view")).toBe(true);
  expect(r.namedRoutes().has("posts.show")).toBe(false);
  expect(r.namedRoutes().has("posts.create")).toBe(false);
  expect(r.namedRoutes().has("posts.store")).toBe(false);
  expect(r.namedRoutes().has("posts.destroy")).toBe(true);
  expect(r.match("GET", "/posts/1")?.params.article).toBe("1");
  expect(r.route("posts.view", { article: 1 })).toBe("/posts/1");

  const r2 = new Router();
  r2.apiResource("posts", PostsController, { except: ["destroy"] });
  expect(r2.namedRoutes().has("posts.index")).toBe(true);
  expect(r2.namedRoutes().has("posts.destroy")).toBe(false);
  expect(r2.namedRoutes().has("posts.create")).toBe(false);
});

test("nested resource shallow nesting", () => {
  const r = new Router();
  r.resource("photos.comments", PostsController, { shallow: true });

  expect(r.match("GET", "/photos/1/comments")).toBeDefined();
  expect(r.match("POST", "/photos/1/comments")).toBeDefined();
  // Shallow member routes drop the parent segment.
  expect(r.match("GET", "/comments/9")?.params.comment).toBe("9");
  expect(r.match("GET", "/photos/1/comments/9")).toBeUndefined();
  expect(r.namedRoutes().has("photos.comments.index")).toBe(true);
  expect(r.namedRoutes().has("comments.show")).toBe(true);
});

test("scopeBindings fails when child does not belong to parent", async () => {
  const r = new Router();
  const posts = new Map([
    ["10", { id: 10, userId: 1, title: "mine" }],
    ["20", { id: 20, userId: 2, title: "other" }],
  ]);
  const users = new Map([
    [
      "1",
      {
        id: 1,
        resolveChildRouteBinding(childType: string, value: string) {
          if (childType !== "post") return null;
          const post = posts.get(String(value));
          if (!post || post.userId !== this.id) return null;
          return post;
        },
      },
    ],
  ]);

  r.model("user", {
    find: (id) => users.get(String(id)) ?? null,
  });
  r.model("post", {
    find: (id) => posts.get(String(id)) ?? null,
  });
  r.get("/users/{user}/posts/{post}", async (req) =>
    json(req.model("post")),
  ).scopeBindings();

  const okHit = r.match("GET", "/users/1/posts/10")!;
  const okReq = new Request(
    new globalThis.Request("http://localhost/users/1/posts/10"),
    okHit.params,
  );
  await r.resolveBindings(okReq);
  expect(okReq.model<{ id: number; userId: number; title: string }>("post")).toEqual({ id: 10, userId: 1, title: "mine" });

  r.match("GET", "/users/1/posts/20");
  const badReq = new Request(
    new globalThis.Request("http://localhost/users/1/posts/20"),
    { user: "1", post: "20" },
  );
  expect(() => r.resolveBindings(badReq)).toThrow(HttpException);
});

test("withoutScopedBindings skips child scoping", async () => {
  const r = new Router();
  let scopedCalls = 0;
  r.model("user", {
    find: (id) => ({
      id: Number(id),
      resolveChildRouteBinding() {
        scopedCalls++;
        return null;
      },
    }),
  });
  r.model("post", {
    find: (id) => ({ id: Number(id) }),
  });
  r.scopeBindings()
    .prefix("users/{user}")
    .group(() => {
      r.get("/posts/{post}", async (req) => json(req.model("post")))
        .withoutScopedBindings()
        .name("posts.show");
    });

  const hit = r.match("GET", "/users/1/posts/9")!;
  const req = new Request(
    new globalThis.Request("http://localhost/users/1/posts/9"),
    hit.params,
  );
  await r.resolveBindings(req);
  expect(scopedCalls).toBe(0);
  expect(req.model<{ id: number }>("post")).toEqual({ id: 9 });
});

test("soft-deleted model 404s by default; withTrashed resolves", async () => {
  const r = new Router();
  const trashed = { id: 5, title: "gone", deleted_at: "2026-01-01" };
  r.model("post", {
    find: () => null, // soft-delete scope excludes trashed
    resolveRouteBinding: () => null,
    resolveSoftDeletableRouteBinding: (value) =>
      String(value) === "5" ? trashed : null,
  });
  r.get("/posts/{post}", async (req) => json(req.model("post")));

  r.match("GET", "/posts/5");
  const missing = new Request(
    new globalThis.Request("http://localhost/posts/5"),
    { post: "5" },
  );
  expect(() => r.resolveBindings(missing)).toThrow(HttpException);

  const reg = r
    .get("/trashed/{post}", async (req) => json(req.model("post")))
    .withTrashed();
  expect(r.routes[1]!.withTrashed).toBe(true);
  expect(reg.allowsTrashedBindings()).toBe(true);

  const hit = r.match("GET", "/trashed/5")!;
  const req = new Request(
    new globalThis.Request("http://localhost/trashed/5"),
    hit.params,
  );
  await r.resolveBindings(req);
  expect(req.model<typeof trashed>("post")).toEqual(trashed);
});

test("Route.withTrashed() group stamps withTrashed on routes", () => {
  const r = new Router();
  r.withTrashed()
    .prefix("admin")
    .group(() => {
      r.get("/posts/{post}", async () => json({}));
    });
  expect(r.routes[0]!.uri).toBe("/admin/posts/{post}");
  expect(r.routes[0]!.withTrashed).toBe(true);
});


test("RouteRegistrar.inject stamps plan", () => {
  class UserController {
    show() {
      return json({});
    }
  }
  const router = new Router();
  router
    .get("/users/{user}", [UserController, "show"])
    .inject([{ kind: "model", param: "user" }])
    .name("users.show");
  expect(router.routes[0]?.inject).toEqual([{ kind: "model", param: "user" }]);
});

test("missing callback replaces 404 when binding fails", async () => {
  const r = new Router();
  r.model("user", { find: () => null });
  r.get("/users/{user}", async () => json({ ok: true })).missing((req) =>
    json({ gone: req.route("user") }, 410),
  );

  r.match("GET", "/users/9");
  const req = new Request(new globalThis.Request("http://localhost/users/9"), {
    user: "9",
  });
  try {
    await r.resolveBindings(req);
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(HttpResponseException);
    const res = (e as HttpResponseException).response;
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ gone: "9" });
  }
});

test("enum binding resolves allow-listed values and 404s others", async () => {
  const Status = { Draft: "draft", Live: "live" } as const;
  const r = new Router();
  r.enum("status", Status);
  r.get("/posts/{status}", async (req) =>
    json({ status: req.model("status") }),
  );

  const hit = r.match("GET", "/posts/draft")!;
  const ok = new Request(
    new globalThis.Request("http://localhost/posts/draft"),
    hit.params,
  );
  await r.resolveBindings(ok);
  expect(ok.model<string>("status")).toBe("draft");

  r.match("GET", "/posts/archived");
  const bad = new Request(
    new globalThis.Request("http://localhost/posts/archived"),
    { status: "archived" },
  );
  expect(() => r.resolveBindings(bad)).toThrow(HttpException);
});

test("singleton registers show/edit/update routes", () => {
  class ProfileController {
    show() {
      return json({});
    }
    edit() {
      return json({});
    }
    update() {
      return json({});
    }
    create() {
      return json({});
    }
    store() {
      return json({});
    }
    destroy() {
      return json({});
    }
  }
  const r = new Router();
  const registrar = r.singleton("profile", ProfileController);
  expect(r.match("GET", "/profile")).toBeDefined();
  expect(r.match("GET", "/profile/edit")).toBeDefined();
  expect(r.match("PUT", "/profile")).toBeDefined();
  expect(r.match("PATCH", "/profile")).toBeDefined();
  expect(r.match("GET", "/profile/create")).toBeUndefined();
  expect(r.has("profile.show")).toBe(true);
  expect(r.has("profile.edit")).toBe(true);
  expect(r.has("profile.update")).toBe(true);

  registrar.creatable().destroyable();
  expect(r.match("GET", "/profile/create")).toBeDefined();
  expect(r.match("POST", "/profile")).toBeDefined();
  expect(r.match("DELETE", "/profile")).toBeDefined();
});

test("apiSingleton registers show/update and optional store/destroy", () => {
  class ProfileApiController {
    show() {
      return json({});
    }
    update() {
      return json({});
    }
    store() {
      return json({});
    }
    destroy() {
      return json({});
    }
  }
  const r = new Router();
  const registrar = r.apiSingleton("profile", ProfileApiController);
  expect(r.match("GET", "/profile")).toBeDefined();
  expect(r.match("PUT", "/profile")).toBeDefined();
  expect(r.match("GET", "/profile/edit")).toBeUndefined();
  expect(r.match("POST", "/profile")).toBeUndefined();

  registrar.creatable().destroyable();
  expect(r.match("POST", "/profile")).toBeDefined();
  expect(r.match("DELETE", "/profile")).toBeDefined();
});
