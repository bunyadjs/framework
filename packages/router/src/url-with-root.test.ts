import { afterEach, expect, test } from "bun:test";
import { Request } from "@bunyad/http";
import {
  Route,
  Url,
  flushUrlContext,
  route,
  runWithUrlContext,
} from "./index.ts";

afterEach(() => {
  Route.clear();
  flushUrlContext();
  Url.setRoot("http://localhost");
  Url.forceScheme(null);
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("withRoot scopes Url.to / format / route(…, true) outside a request (CLI)", () => {
  Route.get("/posts/{post}", async () => new Response("ok")).name("post.show");
  const out = Url.withRoot("https://a.example/", () => ({
    to: Url.to("/about"),
    format: Url.format("x"),
    url: Url.route("post.show", { post: 1 }, true),
    fn: route("post.show", { post: 2 }, true),
    relative: route("post.show", { post: 3 }),
  }));
  expect(out).toEqual({
    to: "https://a.example/about",
    format: "https://a.example/x",
    url: "https://a.example/posts/1",
    fn: "https://a.example/posts/2",
    relative: "/posts/3",
  });
  expect(route("post.show", { post: 1 }, true)).toBe(
    "http://localhost/posts/1",
  );
  expect(Url.to("/about")).toBe("http://localhost/about");
});

test("withRoot returns the callback result (sync and async)", async () => {
  expect(Url.withRoot("https://a.example", () => 7)).toBe(7);
  await expect(
    Url.withRoot("https://a.example", async () => Url.to("/p")),
  ).resolves.toBe("https://a.example/p");
});

test("concurrent withRoot scopes do not leak", async () => {
  Route.get("/home", async () => new Response("ok")).name("home");
  const run = (root: string) =>
    Url.withRoot(root, async () => {
      const seen: string[] = [];
      for (let i = 0; i < 5; i++) {
        await tick();
        seen.push(route("home", {}, true), Url.to("/x"));
      }
      return seen;
    });
  const [a, b] = await Promise.all([
    run("https://a.example"),
    run("https://b.example"),
  ]);
  expect(new Set(a)).toEqual(
    new Set(["https://a.example/home", "https://a.example/x"]),
  );
  expect(new Set(b)).toEqual(
    new Set(["https://b.example/home", "https://b.example/x"]),
  );
  expect(Url.to("/x")).toBe("http://localhost/x");
});

test("nested withRoot uses the innermost root", () => {
  const out = Url.withRoot("https://outer.example", () => [
    Url.to("/a"),
    Url.withRoot("https://inner.example", () => Url.to("/b")),
    Url.to("/c"),
  ]);
  expect(out).toEqual([
    "https://outer.example/a",
    "https://inner.example/b",
    "https://outer.example/c",
  ]);
});

test("withRoot wins over the bound request origin; forceScheme still applies", () => {
  const req = new Request(new globalThis.Request("http://req.example/page"));
  runWithUrlContext(
    () => {
      expect(Url.to("/p")).toBe("http://req.example/p");
      expect(Url.withRoot("http://site.example", () => Url.to("/p"))).toBe(
        "http://site.example/p",
      );
      Url.forceHttps();
      expect(Url.withRoot("http://site.example", () => Url.to("/p"))).toBe(
        "https://site.example/p",
      );
    },
    { request: req },
  );
});

test("route(…, true) follows Url.setRoot like Url does", () => {
  Route.get("/home", async () => new Response("ok")).name("home");
  Url.setRoot("https://configured.example/");
  expect(route("home", {}, true)).toBe("https://configured.example/home");
  expect(Url.to("/home")).toBe("https://configured.example/home");
});

test("default root is APP_URL, else http://localhost (fresh process)", async () => {
  const script = `
    const { Route, Url, route } = await import(${JSON.stringify(new URL("./index.ts", import.meta.url).href)});
    Route.get("/h", async () => new Response("ok")).name("h");
    console.log(JSON.stringify([route("h", {}, true), Url.to("/h")]));
  `;
  const run = async (env: Record<string, string | undefined>) => {
    const proc = Bun.spawn([process.execPath, "-e", script], {
      env: { ...process.env, ...env },
      stdout: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return JSON.parse(out.trim()) as string[];
  };
  expect(await run({ APP_URL: "https://app.example/" })).toEqual([
    "https://app.example/h",
    "https://app.example/h",
  ]);
  const env = { ...process.env };
  delete env.APP_URL;
  const proc = Bun.spawn([process.execPath, "-e", script], {
    env,
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  expect(JSON.parse(out.trim())).toEqual([
    "http://localhost/h",
    "http://localhost/h",
  ]);
});
