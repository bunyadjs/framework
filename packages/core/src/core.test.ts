import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Application,
  createFetchHandler,
  setFormRequestAction,
} from "../src/index.ts";
import { Router, route, getActiveRouter, setActiveRouter } from "@bunyad/router";
import {
  json,
  HttpException,
  Middleware,
  taggedMiddleware,
  controllerMiddlewareOf,
  FormRequest,
  getMiddlewareAlias,
  type Middleware as MiddlewareContract,
} from "@bunyad/http";

test("kernel forgets scoped instances after each request", async () => {
  const router = new Router();
  let n = 0;
  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();
  app.scoped("reqCounter", () => ({ n: ++n }));

  router.get("/count", () => {
    const a = app.make<{ n: number }>("reqCounter");
    const b = app.make<{ n: number }>("reqCounter");
    return json({ a: a.n, b: b.n, same: a === b });
  });

  const fetch = createFetchHandler(app);
  const r1 = await (await fetch(new Request("http://localhost/count"))).json();
  expect(r1).toEqual({ a: 1, b: 1, same: true });
  const r2 = await (await fetch(new Request("http://localhost/count"))).json();
  expect(r2).toEqual({ a: 2, b: 2, same: true });
});

test("application serves matched route", async () => {
  const router = new Router();
  router.get("/", async () => json({ hello: "world" }));

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/"));
  expect(await res.json()).toEqual({ hello: "world" });
});

test("application serves string route results as HTML", async () => {
  const router = new Router();
  router.get("/up", () => "ok");

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/up"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toBe("ok");
});

test("application serves Collection route results as JSON", async () => {
  const { Collection } = await import("@bunyad/common");
  const router = new Router();
  router.get("/users", () =>
    Collection.fromOwned([{ id: 1, name: "Shah" }, { id: 2, name: "Ada" }]),
  );

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/users"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  expect(await res.json()).toEqual([
    { id: 1, name: "Shah" },
    { id: 2, name: "Ada" },
  ]);
});

test("application serves Promise of Collection like User.search().get()", async () => {
  const { Collection } = await import("@bunyad/common");
  const router = new Router();
  router.get("/up", () =>
    Promise.resolve(Collection.fromOwned([{ name: "shah" }])),
  );

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/up"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ name: "shah" }]);
});

test("application serves object route results as JSON", async () => {
  const router = new Router();
  router.get("/data", () => ({ hello: "world" }));

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/data"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ hello: "world" });
});

test("kernel binds the current request for paginator URLs", async () => {
  const { getPaginatorRequest } = await import("@bunyad/common");
  const router = new Router();
  router.get("/api/v1/units", () => {
    const request = getPaginatorRequest();
    return json({
      path: request?.urlWithoutQuery() ?? null,
      page: request?.input("page") ?? null,
    });
  });

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(
    new Request("http://localhost/api/v1/units?page=2&search=kg"),
  );
  expect(await res.json()).toEqual({
    path: "http://localhost/api/v1/units",
    page: "2",
  });
});

test("route model binding 404s missing models", async () => {
  const router = new Router();
  router.model("post", { find: () => null });
  router.get("/posts/{post}", async (req) => json({ id: req.model("post") }));

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/posts/99"));
  expect(res.status).toBe(404);
});

test("application path and env helpers", async () => {
  const app = new Application({
    basePath: "/tmp/bunyad-app",
    config: { app: { env: "local", debug: true, locale: "en", version: "1.2.3" } },
  });

  expect(app.basePath()).toBe("/tmp/bunyad-app");
  expect(app.basePath("config")).toBe("/tmp/bunyad-app/config");
  expect(app.configPath("app.ts")).toBe("/tmp/bunyad-app/config/app.ts");
  expect(app.databasePath("migrations")).toBe(
    "/tmp/bunyad-app/database/migrations",
  );
  expect(app.storagePath("logs")).toBe("/tmp/bunyad-app/storage/logs");
  expect(app.publicPath("favicon.ico")).toBe(
    "/tmp/bunyad-app/public/favicon.ico",
  );
  expect(app.resourcePath("views")).toBe("/tmp/bunyad-app/resources/views");
  expect(app.langPath("en")).toBe("/tmp/bunyad-app/lang/en");
  expect(app.bootstrapPath("app.ts")).toBe("/tmp/bunyad-app/bootstrap/app.ts");
  expect(app.path("Models")).toBe("/tmp/bunyad-app/app/Models");
  expect(app.viewPath("welcome")).toBe(
    "/tmp/bunyad-app/resources/views/welcome",
  );
  expect(app.environmentFilePath()).toBe("/tmp/bunyad-app/.env");

  expect(app.environment()).toBe("local");
  expect(app.environment("local")).toBe(true);
  expect(app.environment("production")).toBe(false);
  expect(app.isLocal()).toBe(true);
  expect(app.isProduction()).toBe(false);
  expect(app.hasDebugModeEnabled()).toBe(true);
  expect(app.version()).toBe("1.2.3");
  expect(app.getNamespace()).toBe("App");
  expect(app.getLocale()).toBe("en");
  expect(app.isLocale("en")).toBe(true);

  app.useStoragePath("/var/data");
  expect(app.storagePath("x")).toBe("/var/data/x");
  app.loadEnvironmentFrom(".env.testing");
  expect(app.environmentFile()).toBe(".env.testing");
});

test("application bootstrapWith and terminating", async () => {
  const order: string[] = [];
  const app = new Application({ config: { app: { port: 0 } } });

  app.beforeBootstrapping("LoadConfig", () => order.push("before"));
  app.afterBootstrapping("LoadConfig", () => order.push("after"));
  app.booting(() => order.push("booting"));
  app.booted(() => order.push("booted"));
  app.terminating(() => {
    order.push("terminating");
  });

  await app.bootstrapWith([
    function LoadConfig(a) {
      order.push("bootstrap");
      a.config.set("bootstrapped", true);
    },
  ]);
  expect(app.hasBeenBootstrapped()).toBe(true);
  expect(app.config.get<boolean>("bootstrapped")).toBe(true);

  await app.boot();
  expect(app.isBooted()).toBe(true);
  expect(order).toEqual(["before", "bootstrap", "after", "booting", "booted"]);

  await app.terminate();
  expect(order).toContain("terminating");
});

test("application abort throws HttpException", () => {
  const app = new Application({ config: { app: { port: 0 } } });
  expect(() => app.abort(404, "Gone")).toThrow();
  try {
    app.abort(422, "Invalid");
  } catch (e) {
    expect((e as { status: number }).status).toBe(422);
  }
});

test("ServiceProvider register then boot", async () => {
  const { ServiceProvider } = await import("../src/index.ts");
  const order: string[] = [];

  class DemoProvider extends ServiceProvider {
    register(): void {
      order.push("register");
      this.app.instance("demo", "ok");
    }
    boot(): void {
      order.push("boot");
    }
  }

  const app = new Application({ config: { app: { port: 0 } } });
  app.register(DemoProvider);
  expect(order).toEqual(["register"]);
  expect(app.make<string>("demo")).toBe("ok");
  await app.boot();
  expect(order).toEqual(["register", "boot"]);
});

test("ServiceProvider boot injects container dependencies", async () => {
  const { ServiceProvider } = await import("../src/index.ts");
  const { Router } = await import("@bunyad/router");

  let captured: Router | undefined;
  class CaptureProvider extends ServiceProvider {
    // Optional so the override satisfies ServiceProvider.boot's zero-arg
    // signature; the container injects the real Router at runtime via
    // the `.inject` array below.
    boot(router?: Router): void {
      captured = router;
    }
  }
  Object.assign(CaptureProvider.prototype.boot, { inject: [Router] });

  const app = new Application({ config: { app: { port: 0 } } });
  app.register(CaptureProvider);
  await app.boot();
  expect(captured).toBe(app.router);
});

const decoratorSeen: string[] = [];
const markMiddleware = taggedMiddleware("mark", {
  async handle(_request, next) {
    decoratorSeen.push("mark");
    return next();
  },
});

@Middleware(markMiddleware)
class DecoratedController {
  async index() {
    return json({ ok: true });
  }
}

test("controller @Middleware runs via kernel", async () => {
  expect(controllerMiddlewareOf(DecoratedController, "index")).toHaveLength(1);

  decoratorSeen.length = 0;
  const router = new Router();
  router.get("/decorated", [DecoratedController, "index"]);

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/decorated"));
  expect(res.status).toBe(200);
  expect(decoratorSeen).toEqual(["mark"]);
  expect(await res.json()).toEqual({ ok: true });
});

test("resolveAppBasePath uses cwd for bunfs paths", async () => {
  const { resolveAppBasePath, isBunEmbeddedPath } = await import("../src/paths.ts");
  expect(isBunEmbeddedPath("/$bunfs/root/bootstrap")).toBe(true);
  expect(isBunEmbeddedPath("/Users/app/bootstrap")).toBe(false);
  const prev = process.env.BUNYAD_BASE_PATH;
  delete process.env.BUNYAD_BASE_PATH;
  expect(resolveAppBasePath("/$bunfs/root")).toBe(process.cwd());
  process.env.BUNYAD_BASE_PATH = "/tmp/custom-app";
  expect(resolveAppBasePath("/$bunfs/root")).toBe("/tmp/custom-app");
  if (prev === undefined) delete process.env.BUNYAD_BASE_PATH;
  else process.env.BUNYAD_BASE_PATH = prev;
});

class StoreUserRequest extends FormRequest {
  authorize() {
    return true;
  }
  rules() {
    return { name: "required|string" };
  }
}

class StoreUserController {
  async store(request: StoreUserRequest) {
    return json({ name: request.validated("name") });
  }
}

test("kernel hydrates FormRequest before the action runs", async () => {
  setFormRequestAction(StoreUserController, "store", StoreUserRequest);
  const router = new Router();
  router.post("/users", [StoreUserController, "store"]);
  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ada" }),
    }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ name: "Ada" });
});

test("kernel resolves FormRequest exported from the same controller file", async () => {
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
  const mod = await import(
    "./fixtures/app/Http/Controllers/InlineFormController.ts"
  );
  const Controller = mod.InlineFormController as new () => object;
  const router = new Router();
  router.post("/inline", [Controller, "store"]);
  const app = new Application({
    basePath: fixtureRoot,
    router,
    config: { app: { port: 0 } },
  });
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(
    new Request("http://localhost/inline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello" }),
    }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ title: "Hello" });
});

test("Application.configure withRouting and health", async () => {
  const app = await Application.configure("/tmp/bunyad-configure")
    .withRouting({
      health: "/up",
      then: (application) => {
        application.router.get("/hello", async () => json({ ok: true }));
      },
    })
    .create();
  await app.boot();

  expect(app.basePath()).toBe("/tmp/bunyad-configure");
  const fetch = createFetchHandler(app);
  const health = await fetch(new Request("http://localhost/up"));
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const hello = await fetch(new Request("http://localhost/hello"));
  expect(await hello.json()).toEqual({ ok: true });
});

test("application boot points route() at the app router", async () => {
  const previous = getActiveRouter();
  try {
    const router = new Router();
    router.get("/settings", async () => json({})).name("settings");
    const app = new Application({ router, config: { app: { port: 0 } } });
    await app.boot();
    expect(getActiveRouter()).toBe(router);
    expect(route("settings")).toBe("/settings");
  } finally {
    setActiveRouter(previous);
  }
});

test("Application.configure uses a fresh router per create", async () => {
  const first = await Application.configure()
    .withRouting({
      then: (application) => {
        application.router.get("/once", async () => json({ n: 1 })).name("once");
      },
    })
    .create();
  const second = await Application.configure()
    .withRouting({
      then: (application) => {
        application.router.get("/once", async () => json({ n: 2 })).name("once");
      },
    })
    .create();
  await first.boot();
  await second.boot();
  const a = createFetchHandler(first);
  const b = createFetchHandler(second);
  expect(await (await a(new Request("http://localhost/once"))).json()).toEqual({
    n: 1,
  });
  expect(await (await b(new Request("http://localhost/once"))).json()).toEqual({
    n: 2,
  });
});

test("serve fetch wrapper runs around the kernel", async () => {
  const app = await Application.configure()
    .withRouting({
      then: (application) => {
        application.router.get("/ping", async () => json({ ok: true }));
      },
    })
    .create();
  await app.boot();
  const { serve } = await import("../src/serve.ts");
  const server = serve(app, {
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    refresh: false,
    fetch: async (request, _server, next) => {
      const response = await next(request);
      const headers = new Headers(response.headers);
      headers.set("x-wrapped", "1");
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    },
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/ping`);
    expect(res.headers.get("x-wrapped")).toBe("1");
    expect(await res.json()).toEqual({ ok: true });
  } finally {
    server.stop(true);
  }
});

test("serve binds requestIP so request.ip() is the peer address", async () => {
  const { setTrustedProxies } = await import("@bunyad/http");
  setTrustedProxies([]);
  const app = await Application.configure()
    .withRouting({
      then: (application) => {
        application.router.get("/whoami", async (request) =>
          json({
            ip: request.ip(),
            remote: request.remoteAddress() ?? null,
          }),
        );
      },
    })
    .create();
  await app.boot();
  const { serve } = await import("../src/serve.ts");
  const server = serve(app, {
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    refresh: false,
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/whoami`, {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const body = (await res.json()) as { ip: string; remote: string | null };
    // Peer is loopback; spoofed XFF must be ignored when proxies are untrusted.
    expect(body.remote === "127.0.0.1" || body.remote === "::1" || body.remote === "::ffff:127.0.0.1").toBe(true);
    expect(body.ip).toBe(body.remote!);
    expect(body.ip).not.toBe("1.2.3.4");
  } finally {
    server.stop(true);
    setTrustedProxies([]);
  }
});

test("Application.configure withExceptions render", async () => {
  const app = await Application.configure()
    .withRouting({
      then: (application) => {
        application.router.get("/boom", async () => {
          throw new Error("nope");
        });
      },
    })
    .withExceptions((exceptions) => {
      exceptions.render((error) => {
        if (error instanceof Error && error.message === "nope") {
          return json({ caught: true }, 418);
        }
      });
    })
    .create();
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/boom"));
  expect(res.status).toBe(418);
  expect(await res.json()).toEqual({ caught: true });
});

test("withExceptions dontReport reportable context dontFlash", async () => {
  class QuietError extends Error {
    constructor() {
      super("quiet");
      this.name = "QuietError";
    }
  }

  const contexts: Record<string, unknown>[] = [];
  void contexts;
  const app = await Application.configure()
    .withRouting({
      then: (application) => {
        application.router.get("/quiet", async () => {
          throw new QuietError();
        });
      },
    })
    .withExceptions((exceptions) => {
      exceptions.dontReport([QuietError]);
      exceptions.reportable((error) => {
        if (error instanceof QuietError) return false;
      });
      exceptions.context(() => ({ tenant: "acme" }));
      exceptions.dontFlash(["secret"]);
    })
    .create();

  expect(await app.shouldReportException(new QuietError(), 500)).toBe(false);
  expect(await app.exceptionReportContext(new Error("x"))).toEqual({
    tenant: "acme",
  });
  expect(app.dontFlashKeys()).toContain("secret");
  expect(app.dontFlashKeys()).toContain("password");
});

test("Application.configure loads config directory on boot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-config-"));
  await mkdir(join(dir, "config"));
  await writeFile(
    join(dir, "config", "app.ts"),
    `export default { name: "FromScan", env: "testing" };\n`,
  );
  await writeFile(
    join(dir, "config", "custom.ts"),
    `export default (databasePath: (path?: string) => string) => ({ path: databasePath("x") });\n`,
  );
  try {
    const app = await Application.configure(dir).create();
    await app.boot();
    expect(app.config.get<string>("app.name")).toBe("FromScan");
    expect(app.config.get<string>("custom.path")).toBe(join(dir, "database", "x"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("new Application does not scan config on boot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-noconfig-"));
  await mkdir(join(dir, "config"));
  await writeFile(
    join(dir, "config", "app.ts"),
    `export default { name: "ShouldNotLoad" };\n`,
  );
  try {
    const app = new Application({ basePath: dir });
    await app.boot();
    expect(app.config.get("app.name")).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withMiddleware alias, group, and appendToGroup", async () => {
  const seen: string[] = [];
  const first: MiddlewareContract = {
    async handle(_request, next) {
      seen.push("first");
      return next();
    },
  };
  const second: MiddlewareContract = {
    async handle(_request, next) {
      seen.push("second");
      return next();
    },
  };
  const app = await Application.configure()
    .withMiddleware((middleware) => {
      middleware.alias({
        tagged: () => ({
          async handle(_request, next) {
            seen.push("alias");
            return next();
          },
        }),
      });
      middleware.group("stack", [first]);
      middleware.appendToGroup("stack", [second]);
      middleware.priority(["session", "bindings"]);
      middleware.prependToPriorityList("bindings", "auth");
    })
    .withRouting({
      then: (application) => {
        application.router
          .get("/x", async () => json({ ok: true }))
          .middleware("stack", "tagged");
      },
    })
    .create();
  await app.boot();

  expect(getMiddlewareAlias("tagged")).toBeDefined();
  expect(app.getMiddlewarePriority()).toEqual(["session", "auth", "bindings"]);
  expect(app.getMiddlewareGroup("stack")).toHaveLength(2);

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/x"));
  expect(res.status).toBe(200);
  expect(seen).toEqual(["first", "second", "alias"]);
});

test("middleware priority reorders route aliases", async () => {
  const seen: string[] = [];
  const app = await Application.configure()
    .withMiddleware((middleware) => {
      middleware.alias({
        early: () => ({
          async handle(_request, next) {
            seen.push("early");
            return next();
          },
        }),
        late: () => ({
          async handle(_request, next) {
            seen.push("late");
            return next();
          },
        }),
      });
      middleware.priority(["late", "early"]);
    })
    .withRouting({
      then: (application) => {
        application.router
          .get("/ordered", async () => json({ ok: true }))
          .middleware("early", "late");
      },
    })
    .create();
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/ordered"));
  expect(res.status).toBe(200);
  expect(seen).toEqual(["late", "early"]);
});

test("withRouting api applies the api middleware group", async () => {
  const app = await Application.configure()
    .withRouting({
      api: (router) => {
        router.get("/ping", async () => json({ ok: true }));
      },
    })
    .create();
  await app.boot();
  const route = app.router.getRoutes().find((entry) =>
    entry.uri === "/api/ping" || entry.uri === "api/ping",
  );
  expect(route).toBeTruthy();
  expect(route?.middleware).toContain("api");
  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/api/ping"));
  expect(res.status).toBe(200);
});

test("withRouting web applies the web middleware group", async () => {
  const app = await Application.configure()
    .withRouting({
      web: (router) => {
        router.get("/home", async () => json({ ok: true }));
      },
    })
    .create();
  await app.boot();
  const route = app.router.getRoutes().find(
    (entry) => entry.uri === "/home" || entry.uri === "home",
  );
  expect(route?.middleware).toContain("web");
  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/home"));
  expect(res.status).toBe(200);
});

test("compiled boot loads .build/config.json without config/ readdir", async () => {
  const prevCompiled = process.env.BUNYAD_COMPILED;
  const prevDev = process.env.BUNYAD_DEV;
  const prevHot = process.env.BUNYAD_HOT;
  process.env.BUNYAD_COMPILED = "1";
  delete process.env.BUNYAD_DEV;
  delete process.env.BUNYAD_HOT;
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "bunyad-compiled-boot-"));
  try {
    await mkdir(join(dir, ".build"), { recursive: true });
    await writeFile(
      join(dir, ".build", "config.json"),
      JSON.stringify({ app: { name: "compiled-app", port: 0 } }),
    );
    // Poisonous config/ would fail if scanned — omit the directory entirely.
    const app = await Application.configure(dir).create();
    await app.boot();
    expect(app.config.get<string>("app.name")).toBe("compiled-app");
  } finally {
    if (prevCompiled === undefined) delete process.env.BUNYAD_COMPILED;
    else process.env.BUNYAD_COMPILED = prevCompiled;
    if (prevDev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prevDev;
    if (prevHot === undefined) delete process.env.BUNYAD_HOT;
    else process.env.BUNYAD_HOT = prevHot;
  }
});

test("compiled boot skips route Glob and convention model scan", async () => {
  const prevCompiled = process.env.BUNYAD_COMPILED;
  const prevDev = process.env.BUNYAD_DEV;
  const prevHot = process.env.BUNYAD_HOT;
  process.env.BUNYAD_COMPILED = "1";
  delete process.env.BUNYAD_DEV;
  delete process.env.BUNYAD_HOT;
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "bunyad-compiled-glob-"));
  let globConstructs = 0;
  const OrigGlob = Bun.Glob;
  // Count Glob construction used by #stampRouteFileBindings.
  Bun.Glob = class extends OrigGlob {
    constructor(...args: ConstructorParameters<typeof OrigGlob>) {
      globConstructs++;
      super(...args);
    }
  };
  try {
    await mkdir(join(dir, "routes"), { recursive: true });
    await mkdir(join(dir, "app", "Models"), { recursive: true });
    await writeFile(
      join(dir, "routes", "web.ts"),
      "throw new Error('compiled boot must not import routes via Glob');\n",
    );
    await writeFile(
      join(dir, "app", "Models", "User.ts"),
      "throw new Error('compiled boot must not convention-scan Models');\n",
    );
    const router = new Router();
    router.get("/users/{user}", async () => json({ ok: true }));
    const app = new Application({
      basePath: dir,
      router,
      config: { app: { port: 0 } },
    });
    await app.boot();
    expect(globConstructs).toBe(0);
    expect(router.hasBinder("user")).toBe(false);
  } finally {
    Bun.Glob = OrigGlob;
    if (prevCompiled === undefined) delete process.env.BUNYAD_COMPILED;
    else process.env.BUNYAD_COMPILED = prevCompiled;
    if (prevDev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prevDev;
    if (prevHot === undefined) delete process.env.BUNYAD_HOT;
    else process.env.BUNYAD_HOT = prevHot;
  }
});

test("source-dev boot still Globs routes when not compiled", async () => {
  const prevCompiled = process.env.BUNYAD_COMPILED;
  const prevDev = process.env.BUNYAD_DEV;
  delete process.env.BUNYAD_COMPILED;
  process.env.BUNYAD_DEV = "1";
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "bunyad-dev-glob-"));
  let globConstructs = 0;
  const OrigGlob = Bun.Glob;
  Bun.Glob = class extends OrigGlob {
    constructor(...args: ConstructorParameters<typeof OrigGlob>) {
      globConstructs++;
      super(...args);
    }
  };
  try {
    await mkdir(join(dir, "routes"), { recursive: true });
    await writeFile(join(dir, "routes", "web.ts"), "export {};\n");
    const app = new Application({
      basePath: dir,
      router: new Router(),
      config: { app: { port: 0 } },
    });
    await app.boot();
    expect(globConstructs).toBeGreaterThan(0);
  } finally {
    Bun.Glob = OrigGlob;
    if (prevCompiled === undefined) delete process.env.BUNYAD_COMPILED;
    else process.env.BUNYAD_COMPILED = prevCompiled;
    if (prevDev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prevDev;
  }
});


test("withRouting path string loads web routes with web group", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "bunyad-withrouting-path-"));
  try {
    await mkdir(join(dir, "routes"), { recursive: true });
    await writeFile(
      join(dir, "routes", "web.ts"),
      `export default function (router) {
  router.get("/from-file", async () => ({ ok: true }));
}
`,
    );
    const app = await Application.configure(dir)
      .withRouting({ web: "routes/web.ts" })
      .create();
    await app.boot();
    const route = app.router.getRoutes().find(
      (entry) => entry.uri === "/from-file" || entry.uri === "from-file",
    );
    expect(route?.middleware).toContain("web");
    const fetch = createFetchHandler(app);
    const res = await fetch(new Request("http://localhost/from-file"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("withRouting path string api applies api group and apiPrefix", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "bunyad-withrouting-api-"));
  try {
    await mkdir(join(dir, "routes"), { recursive: true });
    await writeFile(
      join(dir, "routes", "api.ts"),
      `export default function (router) {
  router.get("/ping", async () => ({ ok: true }));
}
`,
    );
    const app = await Application.configure(dir)
      .withRouting({ api: "routes/api.ts" })
      .create();
    await app.boot();
    const route = app.router.getRoutes().find((entry) =>
      entry.uri === "/api/ping" || entry.uri === "api/ping",
    );
    expect(route).toBeTruthy();
    expect(route?.middleware).toContain("api");
    const fetch = createFetchHandler(app);
    const res = await fetch(new Request("http://localhost/api/ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("kernel runs global then route then controller middleware", async () => {
  const order: string[] = [];
  const globalMw = taggedMiddleware("global", {
    async handle(_request, next) {
      order.push("global");
      return next();
    },
  });
  const routeMw = taggedMiddleware("route", {
    async handle(_request, next) {
      order.push("route");
      return next();
    },
  });
  const controllerMw = taggedMiddleware("controller", {
    async handle(_request, next) {
      order.push("controller");
      return next();
    },
  });

  @Middleware(controllerMw)
  class OrderedController {
    async index() {
      order.push("action");
      return json({ ok: true });
    }
  }

  const router = new Router();
  router.get("/ordered", [OrderedController, "index"]).middleware(routeMw);
  const app = new Application({ router, config: { app: { port: 0 } } });
  app.middleware([globalMw]);
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/ordered"));
  expect(res.status).toBe(200);
  expect(order).toEqual(["global", "route", "controller", "action"]);
});

test("middleware sees the rendered response when the action throws", async () => {
  const seen: number[] = [];
  const headerMw = taggedMiddleware("headers", {
    async handle(_request, next) {
      const response = await next();
      seen.push(response.status);
      const out = new Response(response.body, response);
      out.headers.set("X-After", "yes");
      return out;
    },
  });

  const router = new Router();
  router.get("/boom", () => {
    throw new HttpException(422, "Nope");
  });
  router.get("/async-boom", async () => {
    throw new HttpException(404, "Gone");
  });
  const app = new Application({ router, config: { app: { port: 0 } } });
  app.middleware([headerMw]);
  await app.boot();
  const fetch = createFetchHandler(app);

  const sync = await fetch(new Request("http://localhost/boom"));
  expect(sync.status).toBe(422);
  expect(sync.headers.get("X-After")).toBe("yes");
  const async_ = await fetch(new Request("http://localhost/async-boom"));
  expect(async_.status).toBe(404);
  expect(async_.headers.get("X-After")).toBe("yes");
  expect(seen).toEqual([422, 404]);
});

test("global middleware runs for unmatched routes", async () => {
  const seen: string[] = [];
  const mw = taggedMiddleware("preflight", {
    async handle(request, next) {
      seen.push(request.method);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "X-Handled": "mw" } });
      }
      const response = await next();
      const out = new Response(response.body, response);
      out.headers.set("X-After", "yes");
      return out;
    },
  });
  const router = new Router();
  router.get("/known", () => json({ ok: true }));
  const app = new Application({ router, config: { app: { port: 0 } } });
  app.middleware([mw]);
  await app.boot();
  const fetch = createFetchHandler(app);

  const preflight = await fetch(new Request("http://localhost/known", { method: "OPTIONS" }));
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("X-Handled")).toBe("mw");
  const missing = await fetch(new Request("http://localhost/missing"));
  expect(missing.status).toBe(404);
  expect(missing.headers.get("X-After")).toBe("yes");
  expect(seen).toEqual(["OPTIONS", "GET"]);
});

test("kernel renders Symfony-style HTML for dd()", async () => {
  const router = new Router();
  router.get("/dump", () => {
    dd({ user: "Ada", id: 1 });
  });
  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(
    new Request("http://localhost/dump", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();
  expect(html).toContain("sf-dump");
  expect(html).toContain("Ada");
  expect(html).toContain("sf-dump-str");
});

test("kernel awaits promises passed to dd()", async () => {
  const router = new Router();
  router.get("/dump-async", () => {
    dd(Promise.resolve({ ready: true }));
  });
  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(
    new Request("http://localhost/dump-async", {
      headers: { Accept: "text/html" },
    }),
  );
  const html = await res.text();
  expect(html).toContain("ready");
  expect(html).not.toContain("&lt;pending&gt;");
});

test("core globals expose view redirect abort route without imports", async () => {
  await import("../src/globals.ts");
  expect(typeof view).toBe("function");
  expect(typeof redirect).toBe("function");
  expect(typeof abort).toBe("function");
  expect(typeof route).toBe("function");
  expect(typeof json).toBe("function");
  expect(typeof asset).toBe("function");
  expect(typeof app).toBe("function");
  expect(typeof config).toBe("function");
});

test("isCompiledBootMode respects BUNYAD_COMPILED and DEV veto", async () => {
  const { isCompiledBootMode } = await import("../src/compiled-boot.ts");
  const prev = {
    compiled: process.env.BUNYAD_COMPILED,
    dev: process.env.BUNYAD_DEV,
    hot: process.env.BUNYAD_HOT,
    nodeEnv: process.env.NODE_ENV,
  };
  try {
    delete process.env.BUNYAD_DEV;
    delete process.env.BUNYAD_HOT;
    process.env.BUNYAD_COMPILED = "1";
    expect(isCompiledBootMode()).toBe(true);
    process.env.BUNYAD_DEV = "1";
    expect(isCompiledBootMode()).toBe(false);
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
