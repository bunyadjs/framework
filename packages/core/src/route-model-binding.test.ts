import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Application,
  createFetchHandler,
  setControllerInjectPlan,
  resolveControllerInjectPlan,
} from "./index.ts";
import { Router, type RouteActionResult } from "@bunyad/router";
import { BunyadError } from "@bunyad/common";
import { Request as BunyadRequest, json } from "@bunyad/http";
import { invokeWithInjectPlan } from "./route-model-action.ts";

test("invokeWithInjectPlan single request preserves arity", () => {
  const req = new BunyadRequest(new Request("http://localhost/"));
  let seen: unknown;
  invokeWithInjectPlan(
    (r) => {
      seen = r;
      return "ok";
    },
    [{ kind: "request" }],
    req,
  );
  expect(seen).toBe(req);
});

test("invokeWithInjectPlan injects bound model", () => {
  const req = new BunyadRequest(new Request("http://localhost/users/1"), {
    user: "1",
  });
  req.setModel("user", { id: 1, name: "Ada" });
  const result = invokeWithInjectPlan(
    (user) => user,
    [{ kind: "model", param: "user" }],
    req,
  );
  expect(result).toEqual({ id: 1, name: "Ada" });
});

test("invokeWithInjectPlan injects scalar route param by name", () => {
  const req = new BunyadRequest(new Request("http://localhost/users/1"), {
    id: "1",
  });
  const result = invokeWithInjectPlan(
    (id) => id,
    [{ kind: "param", param: "id" }],
    req,
  );
  expect(result).toBe("1");
});

test("closure inject plan serves model without req.model()", async () => {
  const router = new Router();
  router.model("user", {
    find: (id) => (String(id) === "1" ? { id: 1, name: "Ada" } : null),
  });
  router.get("/users/{user}", (user: { id: number; name: string }) => user);
  router.setInject(router.routes[0]!, [{ kind: "model", param: "user" }]);

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/users/1"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 1, name: "Ada" });
});

test("controller inject plan receives model arg", async () => {
  class UserController {
    show(user: { id: number }) {
      return json(user);
    }
  }

  const router = new Router();
  router.model("user", {
    find: (id) => (String(id) === "2" ? { id: 2 } : null),
  });
  router.get("/users/{user}", [UserController, "show"]);
  setControllerInjectPlan(UserController, "show", [
    { kind: "model", param: "user" },
  ]);
  router.setInject(router.routes[0]!, [{ kind: "model", param: "user" }]);

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/users/2"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 2 });
});

test("unbound static route stays bare (no binding side effects)", async () => {
  let boundCalls = 0;
  const router = new Router();
  router.model("user", {
    find: () => {
      boundCalls++;
      return { id: 1 };
    },
  });
  router.get("/health", () => json({ ok: true }));

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/health"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(boundCalls).toBe(0);
});

test("route with {param} but no binder does not set bind", async () => {
  const router = new Router();
  router.get("/items/{id}", (req: BunyadRequest) =>
    json({ id: req.route("id") }),
  );

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  expect(router.hasBindings(["id"])).toBe(false);

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/items/42"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: "42" });
});

test("missing bound model still 404s", async () => {
  const router = new Router();
  router.model("post", { find: () => null });
  router.get("/posts/{post}", (post: unknown) => json({ post }));
  router.setInject(router.routes[0]!, [{ kind: "model", param: "post" }]);

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/posts/99"));
  expect(res.status).toBe(404);
});

test("custom key binding 404s instead of empty 200 white screen", async () => {
  const router = new Router();
  router.model("user", {
    find: () => null,
    resolveRouteBinding: () => null,
  });
  router.get("/users/{user:remember_token}", (user: unknown) => user as RouteActionResult);
  router.setInject(router.routes[0]!, [{ kind: "model", param: "user" }]);

  const app = new Application({ router, config: { app: { port: 0 } } });
  await app.boot();

  expect(router.routes[0]!.bindingFields).toEqual({
    user: "remember_token",
  });

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/users/nope"));
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body.length).toBeGreaterThan(0);
});

test("boot stamps inject for non-web route files (e.g. central.ts)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-central-routes-"));
  await mkdir(join(dir, "routes"));
  await mkdir(join(dir, "app", "Models"), { recursive: true });
  await writeFile(
    join(dir, "app", "Models", "User.ts"),
    `export default class User {
  static find(id) { return id === "1" ? { id: 1, name: "Ada" } : null; }
}
`,
  );
  await writeFile(
    join(dir, "routes", "central.ts"),
    `import type User from "../app/Models/User.ts";
// Typed closure for scanner:
Route.get("/users1/{user}", (user: User) => user);
`,
  );

  const router = new Router();
  router.get("/users1/{user}", (user: { id: number; name: string }) => user);

  const app = new Application({
    basePath: dir,
    router,
    config: { app: { port: 0 } },
  });
  await app.boot();

  expect(router.hasBinder("user")).toBe(true);
  expect(router.routes[0]!.inject).toEqual([{ kind: "model", param: "user" }]);

  const fetch = createFetchHandler(app);
  const res = await fetch(new Request("http://localhost/users1/1"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 1, name: "Ada" });
});

test("fail-closed when inject plan missing in production (no Glob)", async () => {
  const prevCompiled = process.env.BUNYAD_COMPILED;
  const prevNode = process.env.NODE_ENV;
  const prevDev = process.env.BUNYAD_DEV;
  const prevHot = process.env.BUNYAD_HOT;
  process.env.BUNYAD_COMPILED = "1";
  process.env.NODE_ENV = "production";
  delete process.env.BUNYAD_DEV;
  delete process.env.BUNYAD_HOT;

  let globConstructs = 0;
  const OrigGlob = Bun.Glob;
  Bun.Glob = class extends OrigGlob {
    constructor(...args: ConstructorParameters<typeof OrigGlob>) {
      globConstructs++;
      super(...args);
    }
  };

  class ProdMissingController {
    show() {
      return json({ ok: true });
    }
  }

  try {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-inject-fail-"));
    const app = new Application({
      basePath: dir,
      router: new Router(),
      config: { app: { port: 0 } },
    });
    await app.boot();

    expect(() =>
      resolveControllerInjectPlan(ProdMissingController, "show", app, ["user"]),
    ).toThrow(BunyadError);
    expect(globConstructs).toBe(0);
  } finally {
    Bun.Glob = OrigGlob;
    if (prevCompiled === undefined) delete process.env.BUNYAD_COMPILED;
    else process.env.BUNYAD_COMPILED = prevCompiled;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevDev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prevDev;
    if (prevHot === undefined) delete process.env.BUNYAD_HOT;
    else process.env.BUNYAD_HOT = prevHot;
  }
});

test("stamped controller inject plan works in production without Glob", async () => {
  const prevCompiled = process.env.BUNYAD_COMPILED;
  const prevNode = process.env.NODE_ENV;
  const prevDev = process.env.BUNYAD_DEV;
  const prevHot = process.env.BUNYAD_HOT;
  process.env.BUNYAD_COMPILED = "1";
  process.env.NODE_ENV = "production";
  delete process.env.BUNYAD_DEV;
  delete process.env.BUNYAD_HOT;

  let globConstructs = 0;
  const OrigGlob = Bun.Glob;
  Bun.Glob = class extends OrigGlob {
    constructor(...args: ConstructorParameters<typeof OrigGlob>) {
      globConstructs++;
      super(...args);
    }
  };

  class StampedController {
    show(user: { id: number }) {
      return json(user);
    }
  }

  try {
    setControllerInjectPlan(StampedController, "show", [
      { kind: "model", param: "user" },
    ]);

    const router = new Router();
    router.model("user", {
      find: (id) => (String(id) === "3" ? { id: 3 } : null),
    });
    router.get("/users/{user}", [StampedController, "show"]);
    router.setInject(router.routes[0]!, [{ kind: "model", param: "user" }]);

    const app = new Application({
      router,
      config: { app: { port: 0 } },
    });
    await app.boot();

    const plan = resolveControllerInjectPlan(
      StampedController,
      "show",
      app,
      ["user"],
    );
    expect(plan).toEqual([{ kind: "model", param: "user" }]);
    expect(globConstructs).toBe(0);

    const fetch = createFetchHandler(app);
    const res = await fetch(new Request("http://localhost/users/3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 3 });
  } finally {
    Bun.Glob = OrigGlob;
    if (prevCompiled === undefined) delete process.env.BUNYAD_COMPILED;
    else process.env.BUNYAD_COMPILED = prevCompiled;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevDev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prevDev;
    if (prevHot === undefined) delete process.env.BUNYAD_HOT;
    else process.env.BUNYAD_HOT = prevHot;
  }
});


test("same-named controllers each get their own inject plan", async () => {
  const prevDev = process.env.BUNYAD_DEV;
  process.env.BUNYAD_DEV = "1";
  try {
    // Two apps (or two folders) with a `UserController` whose `show` takes different arguments.
    const make = async (source: string) => {
      const dir = await mkdtemp(join(tmpdir(), "bunyad-same-name-"));
      await mkdir(join(dir, "app/Http/Controllers"), { recursive: true });
      await writeFile(join(dir, "app/Http/Controllers/UserController.ts"), source);
      const router = new Router();
      router.model("user", { find: () => null });
      const app = new Application({ basePath: dir, router, config: { app: { port: 0 } } });
      await app.boot();
      return app;
    };
    const webApp = await make(`export default class UserController { show(user: User) { return user; } }`);
    const apiApp = await make(`export default class UserController { show(request: Request) { return request; } }`);

    const WebUserController = class UserController { show(user: unknown) { return user; } };
    const ApiUserController = class UserController { show(request: unknown) { return request; } };

    expect(await resolveControllerInjectPlan(WebUserController, "show", webApp, ["user"])).toEqual([{ kind: "model", param: "user" }]);
    // Resolved after the web one: must read its own file, not reuse the first by name.
    expect(await resolveControllerInjectPlan(ApiUserController, "show", apiApp, [])).toEqual([{ kind: "request" }]);
  } finally {
    if (prevDev === undefined) delete process.env.BUNYAD_DEV;
    else process.env.BUNYAD_DEV = prevDev;
  }
});
