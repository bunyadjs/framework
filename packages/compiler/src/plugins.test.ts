import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  compile,
  createConfigPlugin,
  createMiddlewarePlugin,
  createMigrationsPlugin,
  createProvidersPlugin,
  createServerPlugin,
  createWorkersPlugin,
  type AnalyzeContext,
  type CompilerPlugin,
  type GenerateContext,
} from "./index.ts";

const routerEntry = resolve(import.meta.dir, "../../router/src/index.ts");

let root: string;

const realWarn = console.warn;

beforeEach(async () => {
  console.warn = () => {};
  root = await mkdtemp(join(tmpdir(), "bunyad-compiler-"));
});

afterEach(async () => {
  console.warn = realWarn;
  await rm(root, { recursive: true, force: true });
});

async function write(rel: string, contents: string) {
  const file = join(root, rel);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, contents);
  return file;
}

function analyzeCtx(): AnalyzeContext {
  return { root, outDir: join(root, ".build"), diagnostics: [], ir: new Map() };
}

function generateCtx(base: AnalyzeContext) {
  const modules: Record<string, string> = {};
  const files: Record<string, string> = {};
  const meta: Record<string, unknown> = {};
  const entries: Record<string, string> = {};
  const ctx: GenerateContext = {
    ...base,
    writeModule(name, fileName, contents) {
      files[fileName] = contents;
      modules[name] = `./${fileName}`;
    },
    setManifestModule(name, path) {
      modules[name] = path;
    },
    setManifestMeta(plugin, data) {
      meta[plugin] = data;
    },
    setEntry(name, path) {
      entries[name] = path;
    },
  };
  return { ctx, modules, files, meta, entries };
}

/** A route file with no routes: enough for compile() to run the router plugin. */
async function emptyRoutes() {
  return write("routes/web.ts", "export default function () {}\n");
}

describe("compile()", () => {
  test("runs plugins in order: built-ins first, user plugins last, analyze before generate", async () => {
    const log: string[] = [];
    const mk = (name: string): CompilerPlugin => ({
      name,
      analyze: () => void log.push(`analyze:${name}`),
      generate: () => void log.push(`generate:${name}`),
    });
    const manifest = await compile({
      root,
      routesEntries: [await emptyRoutes()],
      plugins: [mk("first"), mk("second")],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    });

    expect(manifest.plugins).toEqual([
      "router",
      "middleware",
      "providers",
      "migrations",
      "discovery",
      "config",
      "server",
      "workers",
      "first",
      "second",
    ]);
    expect(log).toEqual([
      "analyze:first",
      "analyze:second",
      "generate:first",
      "generate:second",
    ]);
  });

  test("fails with BUNYAD_COMPILE_FAILED when no route entries are given", async () => {
    const error = await compile({
      root,
      plugins: [],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    }).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("BUNYAD_COMPILE_FAILED");
    expect(error.message).toContain("BUNYAD_ROUTE_001");
    expect(existsSync(join(root, ".build/manifest.json"))).toBe(false);
  });

  test("reports an unloadable route entry as BUNYAD_ROUTE_013", async () => {
    const bad = await write("routes/web.ts", "throw new Error('boom from route file');\n");
    const error = await compile({
      root,
      routesEntries: [bad],
      plugins: [],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    }).catch((e) => e);
    expect(error.code).toBe("BUNYAD_COMPILE_FAILED");
    expect(error.message).toContain("BUNYAD_ROUTE_013");
    expect(error.message).toContain("boom from route file");
    expect(error.message).toContain(`--> ${bad}`);
  });

  test("a user plugin error diagnostic aborts compile and reports file:line", async () => {
    const failing: CompilerPlugin = {
      name: "failing",
      analyze(ctx) {
        ctx.diagnostics.push({ code: "X_001", message: "nope", file: "a.ts", line: 7 });
      },
    };
    const error = await compile({
      root,
      routesEntries: [await emptyRoutes()],
      plugins: [failing],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    }).catch((e) => e);
    expect(error.code).toBe("BUNYAD_COMPILE_FAILED");
    expect(error.message).toBe("X_001: nope\n  --> a.ts:7");
  });

  test("an error raised during generate also aborts, and writes no manifest", async () => {
    const late: CompilerPlugin = {
      name: "late",
      generate(ctx) {
        ctx.diagnostics.push({ code: "LATE_001", message: "too late" });
      },
    };
    const error = await compile({
      root,
      routesEntries: [await emptyRoutes()],
      plugins: [late],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    }).catch((e) => e);
    expect(error.message).toBe("LATE_001: too late");
    expect(existsSync(join(root, ".build/manifest.json"))).toBe(false);
    expect(existsSync(join(root, ".build/server.ts"))).toBe(false);
  });

  test("warnings are logged but do not fail compile", async () => {
    const warn: CompilerPlugin = {
      name: "warn",
      analyze(ctx) {
        ctx.diagnostics.push({ code: "W_001", message: "careful", severity: "warning" });
      },
    };
    const original = console.warn;
    const seen: string[] = [];
    console.warn = (msg: unknown) => void seen.push(String(msg));
    try {
      await compile({
        root,
        routesEntries: [await emptyRoutes()],
        plugins: [warn],
        bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
      });
    } finally {
      console.warn = original;
    }
    expect(seen).toContain("W_001: careful");
    // missing optional bootstrap files are warnings, not failures
    expect(seen.some((m) => m.startsWith("BUNYAD_MW_001"))).toBe(true);
    expect(seen.some((m) => m.startsWith("BUNYAD_PROV_001"))).toBe(true);
  });

  test("manifest defaults: app name, version, ISO timestamp, and outDir default", async () => {
    const manifest = await compile({
      root,
      routesEntries: [await emptyRoutes()],
      plugins: [],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    });
    expect(manifest.app).toBe("app");
    expect(manifest.version).toBe(1);
    expect(new Date(manifest.generatedAt).toISOString()).toBe(manifest.generatedAt);

    const onDisk = JSON.parse(await readFile(join(root, ".build/manifest.json"), "utf8"));
    expect(onDisk).toEqual(manifest);
    expect(manifest.entries.http).toBe("./server.ts");
    expect(manifest.meta.router).toMatchObject({ count: 0 });
  });

  test("legacy routesEntry option is accepted, and routesEntries takes precedence", async () => {
    const good = await emptyRoutes();
    const manifest = await compile({
      root,
      routesEntry: join(root, "routes/missing.ts"),
      routesEntries: [good],
      plugins: [],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    });
    expect(manifest.meta.router).toMatchObject({ count: 0 });
  });

  test("a closure route is skipped with a BUNYAD_ROUTE_010 warning, not an error", async () => {
    const entry = await write(
      "routes/web.ts",
      `import { Route } from ${JSON.stringify(routerEntry)};
Route.get("/closure", () => new Response("hi"));
`,
    );
    const original = console.warn;
    const seen: string[] = [];
    console.warn = (msg: unknown) => void seen.push(String(msg));
    let manifest;
    try {
      manifest = await compile({
        root,
        routesEntries: [entry],
        plugins: [],
        bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
      });
    } finally {
      console.warn = original;
    }
    const warning = seen.find((m) => m.startsWith("BUNYAD_ROUTE_010"));
    expect(warning).toContain("/closure");
    expect((manifest.meta.router as { count: number }).count).toBe(0);
    const routes = await readFile(join(root, ".build/routes.ts"), "utf8");
    expect(routes).not.toContain("/closure");
  });

  test("a controller outside app/Http/Controllers fails with BUNYAD_ROUTE_011", async () => {
    await write("elsewhere/Orphan.ts", "export default class Orphan { index() { return 'x'; } }\n");
    const entry = await write(
      "routes/web.ts",
      `import { Route } from ${JSON.stringify(routerEntry)};
import Orphan from "../elsewhere/Orphan.ts";
Route.get("/orphan", [Orphan, "index"]);
`,
    );
    const error = await compile({
      root,
      routesEntries: [entry],
      plugins: [],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    }).catch((e) => e);
    expect(error.code).toBe("BUNYAD_COMPILE_FAILED");
    expect(error.message).toContain("BUNYAD_ROUTE_011");
    expect(error.message).toContain("[/orphan]");
  });

  test("a discovered controller is emitted into routes.ts", async () => {
    await write(
      "app/Http/Controllers/PingController.ts",
      "export default class PingController { index() { return 'pong'; } }\n",
    );
    const entry = await write(
      "routes/web.ts",
      `import { Route } from ${JSON.stringify(routerEntry)};
import PingController from "../app/Http/Controllers/PingController.ts";
Route.get("/ping", [PingController, "index"]).name("ping");
`,
    );
    const manifest = await compile({
      root,
      routesEntries: [entry],
      plugins: [],
      bootstrap: { applicationModule: join(root, "bootstrap/app.ts") },
    });
    expect((manifest.meta.router as { count: number }).count).toBe(1);
    const routes = await readFile(join(root, ".build/routes.ts"), "utf8");
    expect(routes).toContain("PingController");
    expect(routes).toContain('name("ping")');
    expect(routes).toContain(".inject([])");
  });
});

describe("middleware and providers plugins", () => {
  test("missing entry is a warning and generates nothing", async () => {
    const ctx = analyzeCtx();
    const plugin = createMiddlewarePlugin();
    await plugin.analyze!(ctx);
    expect(ctx.diagnostics).toHaveLength(1);
    expect(ctx.diagnostics[0]).toMatchObject({ code: "BUNYAD_MW_001", severity: "warning" });
    const gen = generateCtx(ctx);
    await plugin.generate!(gen.ctx);
    expect(gen.files).toEqual({});
    expect(gen.modules).toEqual({});
  });

  test("an entry without registerMiddleware is an error (BUNYAD_MW_002)", async () => {
    const entry = await write("bootstrap/middleware.ts", "export const nope = 1;\n");
    const ctx = analyzeCtx();
    await createMiddlewarePlugin({ middlewareEntry: entry }).analyze!(ctx);
    expect(ctx.diagnostics).toEqual([
      expect.objectContaining({ code: "BUNYAD_MW_002", file: entry }),
    ]);
    // severity defaults to error
    expect(ctx.diagnostics[0]!.severity).toBeUndefined();
  });

  test("a valid entry re-exports with a relative import path", async () => {
    const entry = await write(
      "bootstrap/middleware.ts",
      "export function registerMiddleware() {}\n",
    );
    const ctx = analyzeCtx();
    const plugin = createMiddlewarePlugin();
    await plugin.analyze!(ctx);
    expect(ctx.diagnostics).toEqual([]);
    const gen = generateCtx(ctx);
    await plugin.generate!(gen.ctx);
    expect(gen.files["middleware.ts"]).toContain(
      'export { registerMiddleware } from "../bootstrap/middleware.ts";',
    );
    expect(gen.meta.middleware).toEqual({ entry, present: true });
  });

  test("providers: missing registerProviders is an error, valid entry is re-exported", async () => {
    const bad = await write("bootstrap/providers.ts", "export default 1;\n");
    const badCtx = analyzeCtx();
    await createProvidersPlugin({ providersEntry: bad }).analyze!(badCtx);
    expect(badCtx.diagnostics[0]).toMatchObject({ code: "BUNYAD_PROV_002", file: bad });

    // a different file: the bad entry above is already in the module cache
    const goodEntry = await write("bootstrap/providers-ok.ts", "export function registerProviders() {}\n");
    const ctx = analyzeCtx();
    const plugin = createProvidersPlugin({ providersEntry: goodEntry });
    await plugin.analyze!(ctx);
    const gen = generateCtx(ctx);
    plugin.generate!(gen.ctx);
    expect(gen.files["providers.ts"]).toContain('from "../bootstrap/providers-ok.ts"');
  });
});

describe("migrations plugin", () => {
  test("no migrations directory yields an empty IR and no output", async () => {
    const ctx = analyzeCtx();
    const plugin = createMigrationsPlugin();
    await plugin.analyze!(ctx);
    expect(ctx.ir.get("migrations")).toEqual({ migrations: [] });
    const gen = generateCtx(ctx);
    plugin.generate!(gen.ctx);
    expect(gen.files).toEqual({});
  });

  test("migrations are sorted by name and identifiers are sanitised", async () => {
    await write("database/migrations/2024_02_create-posts.ts", "export const up = 1; export const down = 2;\n");
    await write("database/migrations/2024_01_create_users.ts", "export const up = 1; export const down = 2;\n");
    await write("database/migrations/notes.md", "ignored");
    const ctx = analyzeCtx();
    const plugin = createMigrationsPlugin();
    await plugin.analyze!(ctx);
    const gen = generateCtx(ctx);
    plugin.generate!(gen.ctx);

    expect(gen.meta.migrations).toEqual({
      count: 2,
      names: ["2024_01_create_users", "2024_02_create-posts"],
    });
    const source = gen.files["migrations.js"]!;
    expect(source).toContain("import * as m_2024_02_create_posts from");
    expect(source.indexOf("2024_01_create_users.ts\", up")).toBeLessThan(
      source.indexOf("2024_02_create-posts.ts\", up"),
    );
    expect(source).not.toContain("notes");
    expect(gen.modules.migrations).toBe("./migrations.js");
  });
});

describe("config plugin", () => {
  test("ignores dotfiles, declaration files and other extensions; prefers .ts over .js", async () => {
    await write("config/app.ts", "export default {};\n");
    await write("config/app.js", "export default {};\n");
    await write("config/.hidden.ts", "export default {};\n");
    await write("config/types.d.ts", "export {};\n");
    await write("config/readme.md", "x");
    await write("config/my-db.js", "export default {};\n");
    const ctx = analyzeCtx();
    const plugin = createConfigPlugin();
    plugin.analyze!(ctx);
    const files = (ctx.ir.get("config") as { files: { key: string; file: string; ident: string }[] }).files;
    const byKey = Object.fromEntries(files.map((f) => [f.key, f]));
    expect(Object.keys(byKey).sort()).toEqual(["app", "my-db"]);
    expect(byKey.app!.file.endsWith("app.ts")).toBe(true);
    expect(byKey["my-db"]!.ident).toBe("config_my_db");

    const gen = generateCtx(ctx);
    plugin.generate!(gen.ctx);
    expect(gen.files["config.ts"]).toContain('"my-db": config_my_db,');
    expect(gen.meta.config).toEqual({ files: 2 });
  });

  test("a missing or empty config directory produces no IR", async () => {
    const none = analyzeCtx();
    createConfigPlugin().analyze!(none);
    expect(none.ir.has("config")).toBe(false);

    await mkdir(join(root, "config"));
    const empty = analyzeCtx();
    createConfigPlugin().analyze!(empty);
    expect(empty.ir.has("config")).toBe(false);
  });
});

describe("server and workers plugins", () => {
  test("server entry imports the app relatively and only loads views when the view plugin ran", () => {
    const base = analyzeCtx();
    const plain = generateCtx(base);
    createServerPlugin({ applicationModule: join(root, "bootstrap/app.ts") }).generate!(plain.ctx);
    expect(plain.files["server.ts"]).toContain('from "../bootstrap/app.ts"');
    expect(plain.files["server.ts"]).not.toContain("setPreloadedViews");
    expect(plain.files["server.ts"]).not.toContain("setPreloadedMigrations");
    expect(plain.entries.http).toBe("./server.ts");

    const withViews = analyzeCtx();
    withViews.ir.set("view", {});
    withViews.ir.set("migrations", { migrations: [{}] });
    withViews.ir.set("discovery", {});
    const gen = generateCtx(withViews);
    createServerPlugin({ applicationModule: join(root, "bootstrap/app.ts") }).generate!(gen.ctx);
    const src = gen.files["server.ts"]!;
    expect(src).toContain("setPreloadedViews");
    expect(src).toContain("setPreloadedMigrations");
    expect(src).toContain("applyPreloadedDiscovery()");
    // preamble must run before the application is imported
    expect(src.indexOf("BUNYAD_COMPILED")).toBeLessThan(src.indexOf("createApplication"));
  });

  test("empty migrations list does not emit the migrations preamble", () => {
    const base = analyzeCtx();
    base.ir.set("migrations", { migrations: [] });
    const gen = generateCtx(base);
    createServerPlugin({ applicationModule: join(root, "app.ts") }).generate!(gen.ctx);
    expect(gen.files["server.ts"]).not.toContain("migrations");
  });

  test("workers import runtime helpers from the framework only when the app depends on it", async () => {
    const run = () => {
      const gen = generateCtx(analyzeCtx());
      createWorkersPlugin({ applicationModule: join(root, "bootstrap/app.ts") }).generate!(gen.ctx);
      return gen;
    };

    const standalone = run();
    expect(standalone.files["queue-worker.ts"]).toContain('from "@bunyad/queue"');
    expect(standalone.files["schedule-worker.ts"]).toContain('from "@bunyad/schedule"');

    await write("package.json", JSON.stringify({ dependencies: { "@bunyad/framework": "^1" } }));
    const viaFramework = run();
    expect(viaFramework.files["queue-worker.ts"]).toContain('getQueue } from "@bunyad/framework"');
    expect(viaFramework.files["schedule-worker.ts"]).toContain('getSchedule } from "@bunyad/framework"');

    await write("package.json", "{ not json");
    expect(run().files["queue-worker.ts"]).toContain('from "@bunyad/queue"');
  });

  test("schedule worker registers routes/console.ts only when it is provided", () => {
    const without = generateCtx(analyzeCtx());
    createWorkersPlugin({ applicationModule: join(root, "app.ts") }).generate!(without.ctx);
    expect(without.files["schedule-worker.ts"]).not.toContain("registerSchedule");
    expect(without.meta.workers).toMatchObject({ console: false, standalone: true });

    const withConsole = generateCtx(analyzeCtx());
    createWorkersPlugin({
      applicationModule: join(root, "app.ts"),
      consoleModule: join(root, "routes/console.ts"),
    }).generate!(withConsole.ctx);
    expect(withConsole.files["schedule-worker.ts"]).toContain("registerSchedule();");
    expect(withConsole.files["standalone.ts"]).toContain('from "../routes/console.ts"');
    expect(withConsole.meta.workers).toMatchObject({ console: true });
    expect(withConsole.entries).toEqual({
      queue: "./queue-worker.ts",
      scheduler: "./schedule-worker.ts",
      app: "./standalone.ts",
    });
  });
});
