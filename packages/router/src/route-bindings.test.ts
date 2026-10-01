import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Request, HttpException, json } from "@bunyad/http";
import {
  Router,
  applyRouteFileBindings,
  parseActionParams,
  parseConstructorParams,
  constructorParamsFromSource,
  registerConventionModels,
  loadRouteModule,
} from "./index.ts";

const routerSelf = new URL("./index.ts", import.meta.url).href;

describe("parseActionParams", () => {
  test("parses typed and untyped params", () => {
    expect(parseActionParams("user: User")).toEqual([
      { name: "user", typeName: "User" },
    ]);
    expect(parseActionParams("req, user: User")).toEqual([
      { name: "req" },
      { name: "user", typeName: "User" },
    ]);
    expect(parseActionParams("req: Request, user: User")).toEqual([
      { name: "req", typeName: "Request" },
      { name: "user", typeName: "User" },
    ]);
  });
});

describe("parseConstructorParams", () => {
  test("parses parameter properties and $ names", () => {
    expect(
      parseConstructorParams("private $guideSteps: GuideStepsService"),
    ).toEqual([{ name: "$guideSteps", typeName: "GuideStepsService" }]);
    expect(
      parseConstructorParams(
        "private readonly $dashboard: DashboardService, private $clock: Clock",
      ),
    ).toEqual([
      { name: "$dashboard", typeName: "DashboardService" },
      { name: "$clock", typeName: "Clock" },
    ]);
    const source = `
export default class GuideStepsController extends Controller {
  constructor(private $guideSteps: GuideStepsService) {
    super();
  }
}
`;
    expect(
      constructorParamsFromSource(source, "GuideStepsController"),
    ).toEqual([{ name: "$guideSteps", typeName: "GuideStepsService" }]);
  });
});

test("applyRouteFileBindings registers model and stamps inject", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-bind-"));
  const modelFile = join(dir, "User.ts");
  const routeFile = join(dir, "web.ts");
  await writeFile(
    modelFile,
    `export default class User {
  static find(id) { return { id: Number(id), name: "Ada" }; }
}
`,
  );
  await writeFile(
    routeFile,
    `import User from "./User.ts";
import { Route } from "ROUTER_SELF";
export default function (router = Route) {
  Route.get("/users/{user}", (user: User) => user);
}
`.replace("ROUTER_SELF", routerSelf),
  );

  const router = new Router();
  await loadRouteModule(routeFile, router);

  expect(router.hasBinder("user")).toBe(true);
  const route = router.routes.find((r) => r.uri === "/users/{user}");
  expect(route?.inject).toEqual([{ kind: "model", param: "user" }]);

  const hit = router.match("GET", "/users/1")!;
  const req = new Request(
    new globalThis.Request("http://localhost/users/1"),
    hit.params,
  );
  router.resolveBindings(req);
  expect(req.model<{ id: number; name: string }>("user")).toEqual({ id: 1, name: "Ada" });
});

test("registerConventionModels binds unbound params from Models dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-conv-"));
  const models = join(dir, "Models");
  await mkdir(models);
  await writeFile(
    join(models, "Post.ts"),
    `export default class Post {
  static find(id) { return id === "9" ? { id: 9 } : null; }
}
`,
  );

  const router = new Router();
  router.get("/posts/{post}", async () => json({}));
  await registerConventionModels(router, models);
  expect(router.hasBinder("post")).toBe(true);

  const missing = new Request(
    new globalThis.Request("http://localhost/posts/1"),
    { post: "1" },
  );
  expect(() => router.resolveBindings(missing)).toThrow(HttpException);
});

test("modelIfAbsent does not override explicit Route.model", () => {
  const router = new Router();
  router.model("user", { find: () => ({ id: "explicit" }) });
  router.modelIfAbsent("user", { find: () => ({ id: "convention" }) });
  const req = new Request(new globalThis.Request("http://localhost/u/1"), {
    user: "1",
  });
  router.resolveBindings(req);
  expect(req.model<{ id: string }>("user")).toEqual({ id: "explicit" });
});

test("applyRouteFileBindings stamps scalar {id} + (id) inject", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-scalar-id-"));
  const routeFile = join(dir, "web.ts");
  await writeFile(
    routeFile,
    `import { Route } from "ROUTER_SELF";
export default function () {
  Route.get("/users/{id}", (id) => id);
}
`.replace("ROUTER_SELF", routerSelf),
  );

  const router = new Router();
  await loadRouteModule(routeFile, router);

  const route = router.routes.find((r) => r.uri === "/users/{id}");
  expect(route?.inject).toEqual([{ kind: "param", param: "id" }]);
});

test("applyRouteFileBindings stamps positional {user} + (id) as scalar", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-positional-"));
  const routeFile = join(dir, "web.ts");
  await writeFile(
    routeFile,
    `import { Route } from "ROUTER_SELF";
export default function () {
  Route.get("/_test/{user}", (id) => id);
}
`.replace("ROUTER_SELF", routerSelf),
  );

  const router = new Router();
  await loadRouteModule(routeFile, router);

  const route = router.routes.find((r) => r.uri === "/_test/{user}");
  expect(route?.inject).toEqual([{ kind: "param", param: "user" }]);
});

test("registerConventionModels skips params only used as scalar inject", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-conv-skip-"));
  const models = join(dir, "Models");
  await mkdir(models);
  await writeFile(
    join(models, "User.ts"),
    `export default class User {
  static find() { return { id: 1 }; }
}
`,
  );
  const routeFile = join(dir, "web.ts");
  await writeFile(
    routeFile,
    `import { Route } from "ROUTER_SELF";
export default function () {
  Route.get("/_test/{user}", (id) => id);
}
`.replace("ROUTER_SELF", routerSelf),
  );

  const router = new Router();
  await loadRouteModule(routeFile, router);
  await registerConventionModels(router, models);
  expect(router.hasBinder("user")).toBe(false);
});

test("applyRouteFileBindings is idempotent for inject stamp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-bind2-"));
  await writeFile(
    join(dir, "User.ts"),
    `export default class User { static find(id) { return { id }; } }`,
  );
  const routeFile = join(dir, "web.ts");
  await writeFile(
    routeFile,
    `import User from "./User.ts";
import { Route } from "ROUTER_SELF";
export default function () {
  Route.get("/users/{user}", (user: User) => user);
}
`.replace("ROUTER_SELF", routerSelf),
  );
  const router = new Router();
  await loadRouteModule(routeFile, router);
  const before = router.routes[0]!.inject;
  await applyRouteFileBindings(router, routeFile);
  expect(router.routes[0]!.inject).toEqual(before);
});
