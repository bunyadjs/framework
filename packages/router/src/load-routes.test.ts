import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Route, Router, loadRouteModule } from "./index.ts";

async function writeRoute(dir: string, name: string, source: string) {
  const path = join(dir, name);
  await writeFile(path, source);
  return path;
}

test("loadRouteModule side-effect Route.get", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-routes-"));
  const path = await writeRoute(
    dir,
    "web.ts",
    `import { Route } from "bunyad-router-self";
Route.get("/side", async () => new Response("ok")).name("side");
`.replace(
      "bunyad-router-self",
      new URL("./index.ts", import.meta.url).href,
    ),
  );
  Route.clear();
  const style = await loadRouteModule(path, Route);
  expect(style).toBe("side-effect");
  expect(Route.routes.some((r) => r.uri === "/side")).toBe(true);
});

test("loadRouteModule default export function", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-routes-"));
  const href = new URL("./index.ts", import.meta.url).href;
  const path = await writeRoute(
    dir,
    "web.ts",
    `import type { Router } from "${href}";
export default function (router: Router) {
  router.get("/def", async () => new Response("ok")).name("def");
}
`,
  );
  const router = new Router();
  const style = await loadRouteModule(path, router);
  expect(style).toBe("default");
  expect(router.routes.some((r) => r.uri === "/def")).toBe(true);
});

test("loadRouteModule registerRoutes BC", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-routes-"));
  const href = new URL("./index.ts", import.meta.url).href;
  const path = await writeRoute(
    dir,
    "web.ts",
    `import type { Router } from "${href}";
export function registerRoutes(router: Router) {
  router.get("/bc", async () => new Response("ok")).name("bc");
}
`,
  );
  const router = new Router();
  const style = await loadRouteModule(path, router);
  expect(style).toBe("registerRoutes");
  expect(router.routes.some((r) => r.uri === "/bc")).toBe(true);
});

test("loadRouteModule rejects registerWebRoutes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-routes-"));
  const path = await writeRoute(
    dir,
    "web.ts",
    `export function registerWebRoutes() {}
`,
  );
  expect(loadRouteModule(path, Route)).rejects.toThrow(/registerWebRoutes/);
});

test("loadRouteModule api.ts applies api prefix and middleware", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-routes-"));
  const href = new URL("./index.ts", import.meta.url).href;
  const path = await writeRoute(
    dir,
    "api.ts",
    `import type { Router } from "${href}";
export default function (router: Router) {
  router.get("/ping", async () => new Response("ok")).name("ping");
}
`,
  );
  const router = new Router();
  const style = await loadRouteModule(path, router);
  expect(style).toBe("default");
  const route = router.getRoutes().find((r) => r.uri.includes("ping"));
  expect(route?.uri).toMatch(/\/?api\/ping/);
  expect(route?.middleware).toContain("api");
});

test("loadRouteModule api.ts apiPrefix false skips conventions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-routes-"));
  const href = new URL("./index.ts", import.meta.url).href;
  const path = await writeRoute(
    dir,
    "api.ts",
    `import type { Router } from "${href}";
export default function (router: Router) {
  router.get("/bare", async () => new Response("ok"));
}
`,
  );
  const router = new Router();
  await loadRouteModule(path, router, { apiPrefix: false });
  expect(router.getRoutes().some((r) => r.uri === "/bare")).toBe(true);
});
