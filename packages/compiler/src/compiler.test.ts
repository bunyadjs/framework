import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { compile } from "../src/index.ts";
import { routeEntries } from "@bunyad/router";

const root = resolve(import.meta.dir, "../../../apps/playground");

// Compiled output left in the app would be picked up by its own tests.
afterAll(async () => {
  for (const dir of [".build", ".build-optimize-test"]) await rm(resolve(root, dir), { recursive: true, force: true });
});

test("compile playground emits models, views, and routes", async () => {
  const outDir = resolve(root, ".build");
  await rm(outDir, { recursive: true, force: true });

  const manifest = await compile({
    root,
    outDir,
    appName: "playground",
    routesEntries: routeEntries(root),
    plugins: [(await import("@bunyad/view")).createViewPlugin()],
    bootstrap: {
      applicationModule: resolve(root, "server.ts"),
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
  expect(manifest.modules.discovery).toBe("./discovery.ts");
  expect(manifest.modules.config).toBe("./config.ts");
  expect(manifest.modules.migrations).toBe("./migrations.js");
  expect((manifest.meta.migrations as { count: number }).count).toBeGreaterThan(0);
  expect((manifest.meta.discovery as { live: number }).live).toBeGreaterThan(0);

  const viewsIndex = await Bun.file(`${outDir}/views/index.js`).text();
  expect(viewsIndex).toContain("(web).welcome.WelcomePage");
  expect(viewsIndex).toContain("MainLayout");

  const welcomeMod = await import(`${outDir}/views/(web)/welcome/WelcomePage.js`);
  expect(typeof welcomeMod.render).toBe("function");
  expect(welcomeMod.render({ title: "Hi", users: [] })).toContain("Hi");

  const routes = await Bun.file(`${outDir}/routes.ts`).text();
  expect(routes).toContain("HelloController");
  expect(routes).toContain("UserController");
  expect(routes).toContain('name("home")');
  expect(routes).toContain('"auth"');
  expect(routes).toContain('"guest"');
  // Middleware declared on a controller (`@Middleware("throttle:auth")`, `@Middleware("auth", "can:delete,post")`) is read from the class, not written into the route.
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
    routesEntries: routeEntries(root),
    plugins: [],
    bootstrap: {
      applicationModule: resolve(root, "server.ts"),
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
    routesEntries: routeEntries(root),
    plugins: [],
    bootstrap: {
      applicationModule: resolve(root, "server.ts"),
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
  const apiRoot = resolve(import.meta.dir, "../../../templates/api");
  const outDir = resolve(apiRoot, ".build-test");
  await rm(outDir, { recursive: true, force: true });

  const manifest = await compile({
    root: apiRoot,
    outDir,
    appName: "api",
    routesEntries: [resolve(apiRoot, "routes")],
    plugins: [],
    bootstrap: {
      applicationModule: resolve(apiRoot, "server.ts"),
    },
  });

  expect((manifest.meta.router as { count: number }).count).toBeGreaterThan(0);
  const routes = await Bun.file(`${outDir}/routes.ts`).text();
  expect(routes).toContain("TokenController");
  // Route-level middleware is compiled in; `@Middleware` on a controller stays on the class.
  // The `api` group is route-level; `auth` and `throttle:api` are `@Middleware` on the controller.
  expect(routes).toContain('"api"');
  expect(routes).toContain("UserController");

  await rm(outDir, { recursive: true, force: true });
});

/** Compile a starter kit and return its generated routes and entry. */
async function compileKit(kit: string, routeFile = "src") {
  const kitRoot = resolve(import.meta.dir, `../../../templates/${kit}`);
  const outDir = resolve(kitRoot, ".build");
  await rm(outDir, { recursive: true, force: true });
  const manifest = await compile({
    root: kitRoot,
    outDir,
    appName: kit,
    routesEntries: [resolve(kitRoot, routeFile)],
    plugins: [(await import("@bunyad/view")).createViewPlugin()],
    bootstrap: { applicationModule: resolve(kitRoot, existsSync(resolve(kitRoot, "bootstrap/app.ts")) ? "bootstrap/app.ts" : "server.ts") },
  });
  const routes = await Bun.file(resolve(outDir, "routes.ts")).text();
  const server = await Bun.file(resolve(outDir, "server.ts")).text();
  await rm(outDir, { recursive: true, force: true });
  return { manifest, routes, server };
}

test("helper routes (Route.view, Route.redirect, Inertia.route, Live.route) survive compile", async () => {
  const react = await compileKit("react", "routes");
  // A page whose folder has no method for it is a route of its own; the form post stays on the controller.
  expect(react.routes).toContain('router.get("/settings/password", () => null).middleware("web", "auth").name("settings.password").page("routes/(app)/settings/password/PasswordPage.tsx")');
  expect(react.routes).toContain('router.get("/login", () => null).middleware("web", "guest").name("login").page("routes/(auth)/login/LoginPage.tsx")');
  // A controller action is still stamped with its arguments: production never looks plans up on disk.
  expect(react.routes).toContain('[ProfileController, "edit"]).middleware("web", "auth").name("settings.profile").page("routes/(app)/settings/profile/ProfilePage.tsx").inject([{ kind: "request" }])');

  const views = await compileKit("views", "routes");
  expect(views.routes).toContain('router.get("/", () => null).middleware("web").name("home").page("routes/WelcomePage.view")');

  const live = await compileKit("live", "routes");
  expect(live.routes).toContain('import { livePage } from "@bunyad/live-components";');
  expect(live.routes).toContain(`router.get("/settings/profile", livePage("(app).settings.profile.ProfileLive"))`);
}, 60_000);

test("an app without views compiles, and its entry does not load the view package", async () => {
  const api = await compileKit("api", "routes");
  expect(api.server).not.toContain("@bunyad/view");
  expect(api.routes).toContain('"/api/me"');
}, 60_000);

test("a route's view file and a page with no controller are compiled in", async () => {
  const kit = await compileKit("react", "routes");
  expect(kit.routes).toMatch(/\.name\("login"\)\.page\("routes\/\(auth\)\/login\/LoginPage\.tsx"\)/);
  expect(kit.routes).toMatch(/router\.get\("\/dashboard", \(\) => null\)\.middleware\("web", "auth", "verified"\)\.name\("dashboard"\)\.page\("routes\/\(app\)\/dashboard\/DashboardPage\.tsx"\)/);
}, 60_000);
