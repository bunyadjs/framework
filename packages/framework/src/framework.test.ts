import { expect, test } from "bun:test";
import { defaultCompilerPlugins, json, Gate } from "../src/index.ts";

test("framework re-exports http and auth", () => {
  expect(typeof json).toBe("function");
  expect(Gate).toBeDefined();
});

test("defaultCompilerPlugins returns router middleware providers discovery config server", () => {
  const plugins = defaultCompilerPlugins({
    routesEntry: "./routes/web.ts",
    applicationModule: "./bootstrap/app.ts",
  });
  expect(plugins).toHaveLength(6);
  expect(plugins.map((p) => p.name)).toEqual([
    "router",
    "middleware",
    "providers",
    "discovery",
    "config",
    "server",
  ]);
});

test("discovery preload skips Glob when setPreloadedDiscovery is set", async () => {
  const { setPreloadedDiscovery, discoverLive } = await import("./discovery.ts");
  const { Application } = await import("@bunyad/core");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  let globConstructs = 0;
  const OrigGlob = Bun.Glob;
  // @ts-expect-error test spy
  Bun.Glob = class extends OrigGlob {
    constructor(...args: ConstructorParameters<typeof OrigGlob>) {
      globConstructs++;
      super(...args);
    }
  };
  try {
    setPreloadedDiscovery({ wire: [] });
    const dir = await mkdtemp(join(tmpdir(), "bunyad-discovery-"));
    const app = new Application({ basePath: dir, config: { app: { port: 0 } } });
    await discoverLive(app);
    expect(globConstructs).toBe(0);
  } finally {
    Bun.Glob = OrigGlob;
    setPreloadedDiscovery({});
  }
});


test("default middleware aliases auth guest can throttle signed verified", async () => {
  // Side-effect registration via framework re-exports of http/auth/router.
  await import("../src/index.ts");
  const { getMiddlewareAlias, resolveMiddleware } = await import("@bunyad/http");
  for (const name of ["auth", "guest", "can", "throttle", "signed", "verified"]) {
    expect(getMiddlewareAlias(name)).toBeDefined();
  }
  expect(typeof resolveMiddleware("auth")).not.toBe("string");
  expect(typeof resolveMiddleware("throttle:api")).not.toBe("string");
  expect(typeof resolveMiddleware("signed")).not.toBe("string");
  expect(typeof resolveMiddleware("verified")).not.toBe("string");
});

test("ViewServiceProvider fail-fast when compiled views missing in compiled boot", async () => {
  const { Application } = await import("@bunyad/core");
  const { ViewServiceProvider } = await import("./providers/ViewServiceProvider.ts");
  const { BunyadError } = await import("@bunyad/common");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const prev = {
    compiled: process.env.BUNYAD_COMPILED,
    dev: process.env.BUNYAD_DEV,
    hot: process.env.BUNYAD_HOT,
    nodeEnv: process.env.NODE_ENV,
  };
  process.env.BUNYAD_COMPILED = "1";
  delete process.env.BUNYAD_DEV;
  delete process.env.BUNYAD_HOT;

  try {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-view-boot-"));
    const app = new Application({
      basePath: dir,
      config: { app: { port: 0 } },
    });
    const provider = new ViewServiceProvider(app);
    let caught: unknown;
    try {
      await provider.boot();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BunyadError);
    expect((caught as InstanceType<typeof BunyadError>).code).toBe(
      "BUNYAD_VIEW_003",
    );
    expect((caught as Error).message).toMatch(/Compiled views missing/);
  } finally {
    if (prev.compiled === undefined) delete process.env.BUNYAD_COMPILED;
    else process.env.BUNYAD_COMPILED = prev.compiled;
    if (prev.dev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prev.dev;
    if (prev.hot === undefined) delete process.env.BUNYAD_HOT;
    else process.env.BUNYAD_HOT = prev.hot;
    if (prev.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prev.nodeEnv;
  }
});

test("ViewServiceProvider boots from preloaded compiled views", async () => {
  const { Application } = await import("@bunyad/core");
  const { ViewServiceProvider } = await import("./providers/ViewServiceProvider.ts");
  const { setPreloadedViews, render, takePreloadedViews } = await import(
    "@bunyad/view"
  );
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  // Clear any leftover preload from parallel tests.
  takePreloadedViews();
  setPreloadedViews({
    home: () => "preloaded-ok",
  });

  const dir = await mkdtemp(join(tmpdir(), "bunyad-view-preload-"));
  const app = new Application({
    basePath: dir,
    config: { app: { port: 0 } },
  });
  await new ViewServiceProvider(app).boot();
  expect(render("home")).toBe("preloaded-ok");
});

test("registerFrameworkProviders except skips session and views", async () => {
  const { Application } = await import("@bunyad/core");
  const { registerFrameworkProviders } = await import("./providers/index.ts");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = await mkdtemp(join(tmpdir(), "bunyad-api-boot-"));
  const prev = {
    connection: process.env.DB_CONNECTION,
    path: process.env.DATABASE_PATH,
    database: process.env.DB_DATABASE,
  };
  process.env.DB_CONNECTION = "sqlite";
  process.env.DATABASE_PATH = join(dir, "test.sqlite");
  delete process.env.DB_DATABASE;

  try {
    const app = new Application({
      basePath: dir,
      config: { app: { port: 0 } },
    });
    registerFrameworkProviders(app, {
      except: [
        "dump",
        "view",
        "filesystems",
        "session",
        "mail",
        "queue",
        "notifications",
        "broadcasting",
        "live",
        "head",
        "inertia",
        "features",
      ],
    });

    expect(app.bound("session.store")).toBe(false);
    expect(app.providerIsLoaded("SessionServiceProvider")).toBe(false);
    expect(app.providerIsLoaded("ViewServiceProvider")).toBe(false);
    expect(app.providerIsLoaded("AuthServiceProvider")).toBe(true);
    expect(app.providerIsLoaded("HttpServiceProvider")).toBe(true);
  } finally {
    if (prev.connection === undefined) delete process.env.DB_CONNECTION;
    else process.env.DB_CONNECTION = prev.connection;
    if (prev.path === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prev.path;
    if (prev.database === undefined) delete process.env.DB_DATABASE;
    else process.env.DB_DATABASE = prev.database;
  }
});

test("registerFrameworkProviders rejects an unknown except name", async () => {
  const { Application } = await import("@bunyad/core");
  const { registerFrameworkProviders } = await import("./providers/index.ts");
  const app = new Application({
    basePath: "/tmp/bunyad-unknown-provider",
    config: { app: { port: 0 } },
  });

  expect(() =>
    registerFrameworkProviders(app, {
      except: ["not-a-provider"] as never,
    }),
  ).toThrow(/Unknown framework provider/);
});
