import { afterEach, expect, test } from "bun:test";
import { Domain, Router } from "@bunyad/router";
import { Application, createFetchHandler } from "../src/index.ts";

afterEach(() => {
  Domain.clear();
  delete process.env.APP_DOMAIN;
});

async function app() {
  const router = new Router();
  router.get("/", () => "marketing");
  router.get("/", (request: { route(name: string): string }) => `tenant ${request.route("tenant")}`).domain("{tenant}.example.test");
  router.get("/", () => "admin").domain("admin.example.test");
  const application = new Application({ basePath: "/tmp/bunyad-domain", router, config: { app: { port: 0 } } });
  await application.boot();
  return createFetchHandler(application);
}

const get = (fetch: (r: Request) => Response | Promise<Response>, host: string) => Promise.resolve(fetch(new Request("http://x/", { headers: { host } }))).then((r) => r.text());

test("routes limited to a host answer for that host, with its parameters", async () => {
  const fetch = await app();
  expect(await get(fetch, "admin.example.test")).toBe("admin");
  expect(await get(fetch, "acme.example.test")).toBe("tenant acme");
  expect(await get(fetch, "other.test")).toBe("marketing");
});

test("a custom domain is routed as the host its resolver names, and answers are cached", async () => {
  process.env.APP_DOMAIN = "example.test";
  let calls = 0;
  Domain.resolver((host) => {
    calls++;
    return host === "shop.acme.com" ? "acme.example.test" : null;
  });
  const fetch = await app();

  expect(await get(fetch, "shop.acme.com")).toBe("tenant acme");
  expect(await get(fetch, "shop.acme.com")).toBe("tenant acme");
  expect(calls).toBe(1);
  // An unknown host falls through to the routes that are not limited to a host.
  expect(await get(fetch, "unknown.com")).toBe("marketing");
  // The app's own domain never reaches the resolver.
  await get(fetch, "admin.example.test");
  expect(calls).toBe(2);

  Domain.forget("shop.acme.com");
  await get(fetch, "shop.acme.com");
  expect(calls).toBe(3);
});
