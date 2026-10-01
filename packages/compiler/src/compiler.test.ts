import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "../src/index.ts";

const root = resolve(import.meta.dir, "../../../apps/playground");

test("compile playground emits middleware, models, and routes", async () => {
  const outDir = resolve(root, ".build");
  await rm(outDir, { recursive: true, force: true });

  const manifest = await compile({
    root,
    outDir,
    appName: "playground",
    routesEntries: [resolve(root, "routes/web.ts")],
    plugins: [(await import("@bunyad/view")).createViewPlugin()],
    bootstrap: {
      applicationModule: resolve(root, "bootstrap/app.ts"),
    },
  });

  expect(manifest.version).toBe(1);
  expect(manifest.entries.http).toBe("./server.ts");
  expect(manifest.entries.queue).toBe("./queue-worker.ts");
  expect(manifest.entries.scheduler).toBe("./schedule-worker.ts");
  expect(manifest.entries.app).toBe("./standalone.ts");
  expect((manifest.meta.router as { count: number }).count).toBeGreaterThanOrEqual(25);
  expect((manifest.meta.router as { models: number }).models).toBeGreaterThanOrEqual(2);
  expect((manifest.meta.view as { count: number }).count).toBeGreaterThan(0);
  expect(manifest.modules.views).toBe("./views/index.js");
  expect(manifest.modules.middleware).toBe("./middleware.ts");
  expect((manifest.meta.middleware as { present: boolean }).present).toBe(true);
  expect(manifest.modules.providers).toBe("./providers.ts");
  expect((manifest.meta.providers as { present: boolean }).present).toBe(true);
  expect(manifest.modules.discovery).toBe("./discovery.ts");
  expect(manifest.modules.config).toBe("./config.ts");
  expect(manifest.modules.migrations).toBe("./migrations.js");
  expect((manifest.meta.migrations as { count: number }).count).toBeGreaterThan(0);
  expect((manifest.meta.discovery as { live: number }).live).toBeGreaterThan(0);

  const middleware = await Bun.file(`${outDir}/middleware.ts`).text();
  expect(middleware).toContain("registerMiddleware");

  const providers = await Bun.file(`${outDir}/providers.ts`).text();
  expect(providers).toContain("registerProviders");

  const viewsIndex = await Bun.file(`${outDir}/views/index.js`).text();
  expect(viewsIndex).toContain("welcome");
  expect(viewsIndex).toContain("auth.login");

  const welcomeMod = await import(`${outDir}/views/welcome.js`);
  expect(typeof welcomeMod.render).toBe("function");
  expect(welcomeMod.render({ title: "Hi", users: [] })).toContain("Hi");

  const routes = await Bun.file(`${outDir}/routes.ts`).text();
  expect(routes).toContain("HelloController");
  expect(routes).toContain("UserController");
  expect(routes).toContain('name("home")');
  expect(routes).toContain('"auth"');
  expect(routes).toContain('"guest"');
  expect(routes).toContain('"throttle:auth"');
  expect(routes).toContain('"can:delete,post"');
  expect(routes).toContain('"auth"');
  expect(routes).toContain('router.model("user", User)');
  expect(routes).toContain('router.model("post", Post)');
  expect(routes).toContain("MetricsController");
  expect(routes).not.toContain("router.optimize()");
  // Compile stamps inject plans (no request-path Glob in production/compiled).
  expect(routes).toContain('.inject([{ kind: "model", param: "user" }])');
  expect(routes).toContain(
    '.inject([{ kind: "request" }, { kind: "model", param: "post" }])',
  );
  expect((manifest.meta.router as { inject: number }).inject).toBeGreaterThan(0);

  const server = await Bun.file(`${outDir}/server.ts`).text();
  expect(server).toContain("createCompiledRouter");
  expect(server).toContain("createApplication");
  expect(server).toContain("applyPreloadedDiscovery");
  expect(server).toContain("BUNYAD_COMPILED");

  const discovery = await Bun.file(`${outDir}/discovery.ts`).text();
  expect(discovery).toContain("registerChannels");
  expect(discovery).toContain("setPreloadedChannels");

  const config = await Bun.file(`${outDir}/config.ts`).text();
  expect(config).toContain("applyCompiledConfig");

  const queueWorker = await Bun.file(`${outDir}/queue-worker.ts`).text();
  expect(queueWorker).toContain("getQueue().daemon");
  expect(queueWorker).toContain("shutdownSignal");

  const scheduleWorker = await Bun.file(`${outDir}/schedule-worker.ts`).text();
  expect(scheduleWorker).toContain("getSchedule().work");
  expect(scheduleWorker).toContain("registerSchedule");
});

test("compile --optimize emits router.optimize()", async () => {
  const outDir = resolve(root, ".build-optimize-test");
  await rm(outDir, { recursive: true, force: true });

  const manifest = await compile({
    root,
    outDir,
    appName: "playground",
    optimize: true,
    routesEntries: [resolve(root, "routes/web.ts")],
    plugins: [],
    bootstrap: {
      applicationModule: resolve(root, "bootstrap/app.ts"),
    },
  });

  expect((manifest.meta.router as { optimize: boolean }).optimize).toBe(true);
  const routes = await Bun.file(`${outDir}/routes.ts`).text();
  expect(routes).toContain("router.optimize()");

  const { createCompiledRouter } = await import(`${outDir}/routes.ts`);
  const router = createCompiledRouter();
  expect(router.match("GET", "/")?.route.name).toBe("home");

  await rm(outDir, { recursive: true, force: true });
});

test("compile emits inject plans on controller routes", async () => {
  const outDir = resolve(root, ".build-inject-test");
  await rm(outDir, { recursive: true, force: true });

  await compile({
    root,
    outDir,
    appName: "playground",
    routesEntries: [resolve(root, "routes/web.ts")],
    plugins: [],
    bootstrap: {
      applicationModule: resolve(root, "bootstrap/app.ts"),
    },
  });

  const { createCompiledRouter } = await import(`${outDir}/routes.ts`);
  const router = createCompiledRouter();
  const userShow = router.match("GET", "/users/1");
  expect(userShow?.route.inject).toEqual([{ kind: "model", param: "user" }]);
  const postShow = router.match("GET", "/posts/1");
  expect(postShow?.route.inject).toEqual([
    { kind: "request" },
    { kind: "model", param: "post" },
  ]);
  const home = router.match("GET", "/");
  expect(home?.route.inject).toEqual([{ kind: "request" }]);

  await rm(outDir, { recursive: true, force: true });
});

test("compile merges web + api route entries", async () => {
  const apiRoot = resolve(import.meta.dir, "../../../apps/my-api");
  const outDir = resolve(apiRoot, ".build-test");
  await rm(outDir, { recursive: true, force: true });

  const manifest = await compile({
    root: apiRoot,
    outDir,
    appName: "my-api",
    routesEntries: [resolve(apiRoot, "routes/api.ts")],
    plugins: [],
    bootstrap: {
      applicationModule: resolve(apiRoot, "bootstrap/app.ts"),
    },
  });

  expect((manifest.meta.router as { count: number }).count).toBeGreaterThan(0);
  const routes = await Bun.file(`${outDir}/routes.ts`).text();
  expect(routes).toContain("TokenController");
  expect(routes).toContain('"throttle:tokens"');
  expect(routes).toContain('"auth"');

  await rm(outDir, { recursive: true, force: true });
});

/** Compile a starter kit and return its generated routes and entry. */
async function compileKit(kit: string, routeFile = "routes/web.ts") {
  const kitRoot = resolve(import.meta.dir, `../../../templates/${kit}`);
  const outDir = resolve(kitRoot, ".build");
  await rm(outDir, { recursive: true, force: true });
  const manifest = await compile({
    root: kitRoot,
    outDir,
    appName: kit,
    routesEntries: [resolve(kitRoot, routeFile)],
    plugins: [(await import("@bunyad/view")).createViewPlugin()],
    bootstrap: { applicationModule: resolve(kitRoot, "bootstrap/app.ts") },
  });
  const routes = await Bun.file(resolve(outDir, "routes.ts")).text();
  const server = await Bun.file(resolve(outDir, "server.ts")).text();
  await rm(outDir, { recursive: true, force: true });
  return { manifest, routes, server };
}

test("helper routes (Route.view, Route.redirect, Inertia.route, Live.route) survive compile", async () => {
  const react = await compileKit("react");
  expect(react.routes).toContain('import { inertiaPage } from "@bunyad/inertia";');
  expect(react.routes).toContain('router.get("/", inertiaPage("welcome", {}))');
  expect(react.routes).toContain('router.redirect("/settings", "/settings/profile", 302)');
  // A controller action without parameters is still stamped: production never looks plans up.
  expect(react.routes).toContain('[AuthenticatedSessionController, "create"]).middleware("web", "guest").name("login").inject([])');

  const views = await compileKit("views");
  expect(views.routes).toContain('router.view("/", "welcome", {"title":"Welcome"}, 200)');

  const live = await compileKit("live");
  expect(live.routes).toContain('import { livePage } from "@bunyad/live";');
  expect(live.routes).toMatch(/router\.get\("\/settings\/profile", livePage\("settings\.profile"\)\)/);
}, 60_000);

test("an app without views compiles, and its entry does not load the view package", async () => {
  const api = await compileKit("api", "routes/api.ts");
  expect(api.server).not.toContain("@bunyad/view");
  expect(api.routes).toContain('"/api/me"');
}, 60_000);
