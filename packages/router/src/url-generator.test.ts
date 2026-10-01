import { afterEach, expect, test } from "bun:test";
import { Request, redirect } from "@bunyad/http";
import {
  Route,
  Router,
  Url,
  Uri,
  action,
  flushUrlContext,
  route,
  runWithUrlContext,
  setActiveRouter,
  url,
} from "../src/index.ts";

afterEach(() => {
  Route.clear();
  flushUrlContext();
  Url.setRoot("http://localhost");
  Url.forceScheme(null);
});

test("url('/path') and url().query", () => {
  expect(url("/posts/1")).toBe("http://localhost/posts/1");
  expect(url().query("/posts", { search: "Laravel" })).toBe(
    "http://localhost/posts?search=Laravel",
  );
  expect(url().query("/posts?sort=latest", { search: "Laravel" })).toBe(
    "http://localhost/posts?sort=latest&search=Laravel",
  );
  expect(url().query("/posts?sort=latest", { sort: "oldest" })).toBe(
    "http://localhost/posts?sort=oldest",
  );
  const withArray = url().query("/posts", { columns: ["title", "body"] });
  expect(withArray).toContain("columns%5B0%5D=title");
  expect(withArray).toContain("columns%5B1%5D=body");
});

test("url().current / full / previous from request context", () => {
  const req = new Request(
    new globalThis.Request("http://example.com/posts/1?q=1", {
      headers: { referer: "http://example.com/home" },
    }),
  );

  runWithUrlContext(() => {
    expect(url().current()).toBe("http://example.com/posts/1");
    expect(url().full()).toBe("http://example.com/posts/1?q=1");
    expect(url().previous()).toBe("http://example.com/home");
    expect(url().previousPath()).toBe("/home");
    expect(url("/about")).toBe("http://example.com/about");
  }, { request: req });
});

test("route helper applies defaults and leftover query params", () => {
  Route.get("/{locale}/posts/{post}", async () => new Response("ok")).name(
    "posts.show",
  );

  runWithUrlContext(() => {
    Url.defaults({ locale: "en" });
    expect(route("posts.show", { post: 1 })).toBe("/en/posts/1");
    expect(route("posts.show", { post: 1, search: "x" })).toBe(
      "/en/posts/1?search=x",
    );
  });
});

test("route accepts model-like params", () => {
  Route.get("/posts/{post}", async () => new Response("ok")).name("post.show");
  expect(route("post.show", { post: { id: 42 } })).toBe("/posts/42");
  expect(
    route("post.show", {
      post: { getRouteKey: () => "slug-a" },
    }),
  ).toBe("/posts/slug-a");
});

class HomeController {
  index() {
    return new Response("home");
  }
}

class ShowController {
  show() {
    return new Response("show");
  }
}

test("action() resolves controller routes", () => {
  Route.get("/home", [HomeController, "index"]).name("home");
  Route.get("/users/{id}", [ShowController, "show"]);

  expect(action([HomeController, "index"])).toBe("http://localhost/home");
  expect(action([ShowController, "show"], { id: 9 }, false)).toBe("/users/9");
});

test("Uri fluent builder", () => {
  const uri = Uri.of("https://example.com")
    .withScheme("http")
    .withHost("test.com")
    .withPort(8000)
    .withPath("/users")
    .withQuery({ page: 2 })
    .withFragment("section-1");

  expect(uri.toString()).toBe("http://test.com:8000/users?page=2#section-1");
});

test("Uri.route and Uri.action", () => {
  Route.get("/dash", [HomeController, "index"]).name("dash");
  expect(Uri.route("dash").path()).toBe("/dash");
  expect(Uri.action([HomeController, "index"]).path()).toBe("/dash");
});

test("absolute route via third argument", () => {
  const r = new Router();
  r.get("/a", async () => new Response()).name("a");
  // Router.route uses APP_URL / localhost when absolute
  expect(r.route("a", {}, true)).toBe("http://localhost/a");
});

test("Url.asset / forceHttps / secure / isValidUrl", () => {
  expect(Url.asset("css/app.css")).toBe("http://localhost/css/app.css");
  expect(Url.assetFrom("https://cdn.example", "js/app.js")).toBe(
    "https://cdn.example/js/app.js",
  );
  expect(Url.secure("/admin")).toBe("https://localhost/admin");
  expect(Url.isValidUrl("https://example.com/a")).toBe(true);
  expect(Url.isValidUrl("/relative")).toBe(false);

  Url.forceHttps();
  expect(Url.to("/x")).toBe("https://localhost/x");
  expect(Url.asset("img.png")).toBe("https://localhost/img.png");
});

test("redirect().back uses previous URL from request context", () => {
  const req = new Request(
    new globalThis.Request("http://example.com/users", {
      headers: { referer: "http://example.com/home" },
    }),
  );

  runWithUrlContext(() => {
    const res = redirect().back();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://example.com/home");
  }, { request: req });
});

test("redirect('/path') and redirect().route", () => {
  const router = new Router();
  setActiveRouter(router);
  router.get("/posts/{id}", () => "ok").name("posts.show");

  const res = redirect("/login");
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toContain("/login");

  expect(redirect().route("posts.show", { id: 3 }).headers.get("Location")).toContain(
    "/posts/3",
  );
});
