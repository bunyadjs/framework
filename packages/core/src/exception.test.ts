import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application, createFetchHandler } from "../src/index.ts";
import {
  parseStack,
  renderExceptionHtml,
  statusFromError,
  wantsJson,
  pickEditorFrame,
  isApplicationFrame,
} from "../src/exception.ts";
import { Router } from "@bunyad/router";
import { HttpException, json, Request } from "@bunyad/http";

test("parseStack extracts file line and function", () => {
  const err = new Error("boom");
  err.stack = `Error: boom
    at index (file:///Users/shah/app/HelloController.ts:7:12)
    at #runAction (/Users/shah/packages/core/src/kernel.ts:115:41)`;
  const frames = parseStack(err);
  expect(frames.length).toBe(2);
  expect(frames[0]?.functionName).toBe("index");
  expect(frames[0]?.line).toBe(7);
  expect(frames[0]?.path).toContain("HelloController.ts");
  expect(frames[1]?.functionName).toBe("#runAction");
});

test("statusFromError maps HttpException and ModelNotFound", () => {
  expect(statusFromError(new HttpException(403, "Nope"))).toBe(403);
  const missing = new Error("No query results");
  missing.name = "ModelNotFoundException";
  expect(statusFromError(missing)).toBe(404);
  expect(statusFromError(new Error("x"))).toBe(500);
});

test("wantsJson respects Accept and Inertia", () => {
  const html = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { Accept: "text/html,application/json" },
    }),
  );
  expect(wantsJson(html)).toBe(false);
  expect(html.expectsJson()).toBe(false);
  expect(html.wantsJson()).toBe(false);

  const api = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { Accept: "application/json" },
    }),
  );
  expect(wantsJson(api)).toBe(true);
  expect(api.expectsJson()).toBe(true);

  const ajaxStar = new Request(
    new globalThis.Request("http://localhost/", {
      headers: {
        Accept: "*/*",
        "X-Requested-With": "XMLHttpRequest",
      },
    }),
  );
  expect(ajaxStar.expectsJson()).toBe(true);
});

test("shouldRenderJsonWhen forces JSON for api paths", async () => {
  const { abort } = await import("@bunyad/http");
  const router = new Router();
  router.get("/api/v1/items/{id}", async () => abort(404));
  const app = new Application({
    router,
    config: { app: { debug: true, port: 0 } },
  });
  app.shouldRenderJsonWhen(
    (request) => request.is("api/*") || request.expectsJson(),
  );
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(
    new globalThis.Request("http://localhost/api/v1/items/missing", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = (await res.json()) as { message: string };
  expect(body.message).toBe("Not Found");
});

test("debug HTML exception page includes message and stack", () => {
  const err = new TypeError("undefined is not an object (evaluating 'users.length')");
  err.stack = `TypeError: undefined is not an object
    at index (${import.meta.path}:1:1)`;
  const html = renderExceptionHtml(err, {
    debug: true,
    appName: "Playground",
    env: "local",
  });
  expect(html).toContain("TypeError");
  expect(html).toContain("undefined is not an object");
  expect(html).toContain("Stack trace");
  expect(html).toContain("Playground");
});

test("pickEditorFrame prefers app code over packages vendor frames", () => {
  // The controller frame must point at a real file so the page can show its source.
  const appRoot = mkdtempSync(join(tmpdir(), "bunyad-frame-"));
  const controllerPath = join(appRoot, "app/Http/Controllers/HelloController.ts");
  mkdirSync(join(appRoot, "app/Http/Controllers"), { recursive: true });
  writeFileSync(
    controllerPath,
    [
      "// controller",
      "",
      "",
      "",
      "",
      "export default class HelloController {",
      "  index() { return users.length; }",
      "}",
      "",
    ].join("\n"),
  );
  try {
    const frames = [
      {
        functionName: "anonymous",
        file: "/Users/shah/Desktop/bunyad/packages/view/src/compiler.ts",
        path: "/Users/shah/Desktop/bunyad/packages/view/src/compiler.ts",
        line: 13,
        column: 14,
      },
      {
        functionName: "view",
        file: "/Users/shah/Desktop/bunyad/packages/view/src/helpers.ts",
        path: "/Users/shah/Desktop/bunyad/packages/view/src/helpers.ts",
        line: 29,
        column: 33,
      },
      {
        functionName: "index",
        file: controllerPath,
        path: controllerPath,
        line: 7,
        column: 12,
      },
    ];
    expect(isApplicationFrame(frames[0]!)).toBe(false);
    expect(isApplicationFrame(frames[2]!)).toBe(true);
    expect(pickEditorFrame(frames)?.path).toContain("HelloController.ts");

    const err = new TypeError("users.length");
    err.stack = `TypeError: users.length
      at anonymous (${frames[0]!.path}:13:14)
      at view (${frames[1]!.path}:29:33)
      at index (${frames[2]!.path}:7:12)`;
    const html = renderExceptionHtml(err, { debug: true });
    expect(html).toContain("HelloController.ts:7");
    expect(html).toContain("export default class HelloController");
    expect(html).toContain("vendor frame");
  } finally {
    rmSync(appRoot, { recursive: true, force: true });
  }
});

test("pickEditorFrame skips internal sql frames without readable source", () => {
  const frames = [
    {
      functionName: "wrapPostgresError",
      file: "internal:sql/postgres",
      path: "internal:sql/postgres",
      line: 176,
      column: 27,
    },
    {
      functionName: "handler",
      file: "/Users/shah/Desktop/app/routes/web.ts",
      path: "/Users/shah/Desktop/app/routes/web.ts",
      line: 12,
      column: 5,
    },
  ];
  expect(isApplicationFrame(frames[0]!)).toBe(false);
  expect(pickEditorFrame(frames)?.path).toContain("routes/web.ts");
});

test("QueryException HTML shows app source SQL and previous exception", () => {
  const root = mkdtempSync(join(tmpdir(), "bunyad-ex-"));
  const routesDir = join(root, "routes");
  mkdirSync(routesDir);
  const routePath = join(routesDir, "web.ts");
  writeFileSync(
    routePath,
    `export default function routes() {\n  // test route\n  return User.findOrFail(id);\n}\n`,
  );

  try {
    const native = new Error('invalid input syntax for type bigint: "10000+"');
    native.name = "PostgresError";
    native.stack = `PostgresError: invalid input syntax for type bigint: "10000+"
    at wrapPostgresError (internal:sql/postgres:176:27)
    at onRejectPostgresQuery (internal:sql/postgres:204:33)`;

    const err = new Error(
      'SQLSTATE[22P02] invalid input syntax for type bigint: "10000+" (SQL: select * from users where id = $1)',
      { cause: native },
    );
    err.name = "QueryException";
    (err as Error & { sql: string; bindings: unknown[]; sqlState: string }).sql =
      "select * from users where id = $1";
    (err as Error & { bindings: unknown[] }).bindings = ["10000+"];
    (err as Error & { sqlState: string }).sqlState = "22P02";
    err.stack = `QueryException: SQLSTATE[22P02] invalid input syntax for type bigint: "10000+"
    at runUnsafe (/Users/shah/Desktop/bunyad/packages/database/src/connection.ts:545:5)
    at findOrFail (/Users/shah/Desktop/bunyad/packages/orm/src/model.ts:1067:12)
    at <anonymous> (${routePath}:3:10)`;

    const html = renderExceptionHtml(err, {
      debug: true,
      appName: "Karobar Point",
      env: "development",
    });
    expect(html).toContain("QueryException");
    expect(html).toContain("routes/web.ts:3");
    expect(html).toContain("User.findOrFail");
    expect(html).toContain("select * from users where id = $1");
    expect(html).toContain("Previous exception");
    expect(html).toContain("PostgresError");
    expect(html).toContain("vendor frame");
    expect(html).toContain("card-full");
    expect(html).toContain('id="bunyad-brand"');
    expect(html).toContain("Bunyad");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production HTML hides stack details", () => {
  const html = renderExceptionHtml(new Error("secret"), { debug: false });
  expect(html).toContain("Server Error");
  expect(html).not.toContain("secret");
  expect(html).not.toContain("Stack trace");
});

test("kernel renders Ignition-style page instead of throwing", async () => {
  const router = new Router();
  router.get("/boom", async () => {
    throw new TypeError("undefined is not an object (evaluating 'users.length')");
  });

  const app = new Application({
    router,
    config: { app: { name: "Playground", debug: true, env: "local", port: 0 } },
  });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(
    new globalThis.Request("http://localhost/boom", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(res.status).toBe(500);
  expect(res.headers.get("content-type")).toContain("text/html");
  const body = await res.text();
  expect(body).toContain("TypeError");
  expect(body).toContain("users.length");
  expect(body).toContain("Stack trace");
});

test("kernel renders HTML 404 for ModelNotFoundException (not Bun overlay)", async () => {
  const router = new Router();
  router.get("/missing", async () => {
    const err = new Error("No query results for model.");
    err.name = "ModelNotFoundException";
    throw err;
  });
  const app = new Application({
    router,
    config: { app: { name: "Playground", debug: true, env: "local", port: 0 } },
  });
  await app.boot();

  const fetch = createFetchHandler(app);
  const res = await fetch(
    new globalThis.Request("http://localhost/missing", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("text/html");
  const body = await res.text();
  expect(body).toContain("ModelNotFoundException");
  expect(body).toContain("No query results for model.");
});

test("kernel JSON errors when Accept is application/json", async () => {
  const router = new Router();
  router.get("/boom", async () => {
    throw new Error("nope");
  });
  const app = new Application({
    router,
    config: { app: { debug: true, port: 0 } },
  });
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(
    new globalThis.Request("http://localhost/boom", {
      headers: { Accept: "application/json" },
    }),
  );
  expect(res.status).toBe(500);
  const body = (await res.json()) as {
    message: string;
    exception: string;
    trace: unknown;
  };
  expect(body.message).toBe("nope");
  expect(body.exception).toBe("Error");
  expect(Array.isArray(body.trace)).toBe(true);
});

test("kernel 404 HTML for browsers", async () => {
  const router = new Router();
  router.get("/", async () => json({ ok: true }));
  const app = new Application({
    router,
    config: { app: { debug: true, port: 0 } },
  });
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(
    new globalThis.Request("http://localhost/missing", {
      headers: { Accept: "text/html" },
    }),
  );
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).toContain("Not Found");
  expect(body).toContain("HttpException");
});

test("kernel abort returns status and headers", async () => {
  const { abort } = await import("@bunyad/http");
  const router = new Router();
  router.get("/denied", async () => abort(403, "Forbidden", { "X-Abort": "1" }));
  const app = new Application({
    router,
    config: { app: { debug: true, port: 0 } },
  });
  await app.boot();
  const fetch = createFetchHandler(app);
  const res = await fetch(
    new globalThis.Request("http://localhost/denied", {
      headers: { Accept: "application/json" },
    }),
  );
  expect(res.status).toBe(403);
  expect(res.headers.get("X-Abort")).toBe("1");
  const body = (await res.json()) as { message: string };
  expect(body.message).toBe("Forbidden");
});
