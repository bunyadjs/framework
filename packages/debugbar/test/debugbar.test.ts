import { afterEach, expect, test } from "bun:test";
import { Application, createFetchHandler } from "@bunyad/core";
import { json } from "@bunyad/http";
import { Router } from "@bunyad/router";
import { CacheHit, CacheMissed } from "@bunyad/cache";
import { fireQueryExecuted } from "@bunyad/database";
import { Dispatcher, getEventDispatcher, setEventDispatcher } from "@bunyad/events";
import { Log, setLogChannel } from "@bunyad/log";
import {
  Debugbar,
  DebugbarServiceProvider,
  MemoryDebugbarStore,
  sanitize,
  type Snapshot,
} from "../src/index.ts";

let dispose: Array<() => void> = [];
afterEach(() => {
  for (const fn of dispose) fn();
  dispose = [];
});

async function boot(debugbar: Record<string, unknown> = { enabled: true }) {
  const router = new Router();
  const app = new Application({ router, config: { app: { port: 0 }, debugbar } });
  app.register(DebugbarServiceProvider);
  await app.boot();
  return { app, router, fetch: createFetchHandler(app) };
}

const page = (body: string) =>
  new Response(`<html><body>${body}</body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

test("injects the bar into HTML and tags the response", async () => {
  const { router, fetch } = await boot();
  router.get("/hello", () => page("<h1>hi</h1>"));

  const res = await fetch(new Request("http://localhost/hello"));
  const html = await res.text();

  expect(html).toContain('id="bunyad-debugbar"');
  expect(html.indexOf("bunyad-debugbar")).toBeLessThan(html.lastIndexOf("</body>"));
  expect(res.headers.get("X-Debugbar-Id")).toMatch(/^[0-9a-f]{16}$/);
});

test("JSON responses are tagged but not modified, and the snapshot is retrievable", async () => {
  const { router, fetch } = await boot();
  router.get("/api/ping", () => json({ ok: true }));

  const res = await fetch(new Request("http://localhost/api/ping?page=2"));
  expect(await res.json()).toEqual({ ok: true });
  const id = res.headers.get("X-Debugbar-Id")!;

  const snap = (await (await fetch(new Request(`http://localhost/_debugbar/${id}`))).json()) as Snapshot;
  expect(snap.request.method).toBe("GET");
  expect(snap.request.path).toBe("/api/ping");
  expect(snap.request.status).toBe(200);
  expect(snap.request.query).toEqual({ page: "2" });

  const latest = (await (await fetch(new Request("http://localhost/_debugbar/latest"))).json()) as Snapshot;
  expect(latest.id).toBe(id);
});

test("records messages, timeline measures and logs per request", async () => {
  const { router, fetch } = await boot();
  setLogChannel({ log() {} });
  router.get("/work", async () => {
    Debugbar.message("starting", "info");
    await Debugbar.measure("heavy", () => Bun.sleep(5));
    Log.warning("careful", { password: "hunter2", note: "ok" });
    return json({});
  });

  const res = await fetch(new Request("http://localhost/work"));
  const snap = (await (
    await fetch(new Request(`http://localhost/_debugbar/${res.headers.get("X-Debugbar-Id")}`))
  ).json()) as Snapshot;

  expect(snap.messages[0]).toMatchObject({ level: "info", message: "starting" });
  expect(snap.timeline[0]!.label).toBe("heavy");
  expect(snap.timeline[0]!.duration).toBeGreaterThanOrEqual(4);
  expect(snap.logs[0]).toMatchObject({ level: "warning", message: "careful" });
  expect(snap.logs[0]!.context).toEqual({ password: "********", note: "ok" });
});

test("captures thrown exceptions and rethrows them to the app handler", async () => {
  const { router, fetch } = await boot();
  router.get("/boom", () => {
    throw new Error("kaput");
  });

  const res = await fetch(new Request("http://localhost/boom", { headers: { Accept: "application/json" } }));
  expect(res.status).toBe(500);

  const latest = (await (await fetch(new Request("http://localhost/_debugbar/latest"))).json()) as Snapshot;
  expect(latest.exceptions[0]).toMatchObject({ name: "Error", message: "kaput" });
});

test("redacts secrets in request data", async () => {
  const { router, fetch } = await boot();
  router.post("/login", () => json({}));

  const res = await fetch(
    new Request("http://localhost/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer abc", Cookie: "sid=1" },
      body: JSON.stringify({ email: "a@b.c", password: "hunter2" }),
    }),
  );
  const snap = (await (
    await fetch(new Request(`http://localhost/_debugbar/${res.headers.get("X-Debugbar-Id")}`))
  ).json()) as Snapshot;

  expect(snap.request.body).toEqual({ email: "a@b.c", password: "********" });
  expect(snap.request.headers.authorization).toBe("********");
  expect(JSON.stringify(snap)).not.toContain("hunter2");
});

test("collects queries (flagging duplicates and slow) and cache activity", async () => {
  setEventDispatcher(new Dispatcher());
  const { router, fetch } = await boot({ enabled: true, slowQueryMs: 50 });
  router.get("/data", async () => {
    const connection = {} as never;
    fireQueryExecuted({ sql: "select * from users where id = ?", bindings: [1], timeMs: 2, connection });
    fireQueryExecuted({ sql: "select * from users where id = ?", bindings: [1], timeMs: 3, connection });
    fireQueryExecuted({ sql: "select * from orders", bindings: [], timeMs: 80, connection });
    await getEventDispatcher().dispatch(new CacheMissed("k", "memory"));
    await getEventDispatcher().dispatch(new CacheHit("k", 1, "memory"));
    return json({});
  });

  const res = await fetch(new Request("http://localhost/data"));
  const snap = (await (
    await fetch(new Request(`http://localhost/_debugbar/${res.headers.get("X-Debugbar-Id")}`))
  ).json()) as Snapshot;

  expect(snap.queries).toMatchObject({ count: 3, duplicates: 2, slow: 1 });
  expect(snap.queries.totalMs).toBe(85);
  expect(snap.queries.items[2]!.slow).toBe(true);
  expect(snap.cache).toMatchObject({ hits: 1, misses: 1 });
});

test("reports N+1 groups and where the query came from", async () => {
  const { router, fetch } = await boot();
  router.get("/n1", async () => {
    const connection = {} as never;
    for (let id = 1; id <= 6; id++) {
      fireQueryExecuted({ sql: "select * from stock where product_id = ?", bindings: [id], timeMs: 1, connection });
    }
    return json({});
  });

  const res = await fetch(new Request("http://localhost/n1"));
  const snap = (await (
    await fetch(new Request(`http://localhost/_debugbar/${res.headers.get("X-Debugbar-Id")}`))
  ).json()) as Snapshot;

  expect(snap.queries.nPlusOne).toBe(6);
  expect(snap.queries.groups[0]).toMatchObject({ count: 6 });
  expect(snap.queries.items[0]!.origin?.file).toContain("debugbar.test.ts");
});

test("queryOrigin: false skips the stack capture", async () => {
  const { router, fetch } = await boot({ enabled: true, queryOrigin: false });
  router.get("/q", () => {
    fireQueryExecuted({ sql: "select 1", bindings: [], timeMs: 1, connection: {} as never });
    return json({});
  });
  const res = await fetch(new Request("http://localhost/q"));
  const snap = (await (
    await fetch(new Request(`http://localhost/_debugbar/${res.headers.get("X-Debugbar-Id")}`))
  ).json()) as Snapshot;
  expect(snap.queries.items[0]!.origin).toBeNull();
});

test("queries outside a request are ignored", async () => {
  await boot();
  expect(() =>
    fireQueryExecuted({ sql: "select 1", bindings: [], timeMs: 1, connection: {} as never }),
  ).not.toThrow();
});

test("is inert when disabled", async () => {
  const { router, fetch } = await boot({ enabled: false });
  router.get("/hello", () => page("x"));

  const res = await fetch(new Request("http://localhost/hello"));
  expect(res.headers.get("X-Debugbar-Id")).toBeNull();
  expect(await res.text()).not.toContain("bunyad-debugbar");
  expect((await fetch(new Request("http://localhost/_debugbar"))).status).toBe(404);
});

test("history page lists requests and the store is capped", async () => {
  const { router, fetch } = await boot({ enabled: true, history: 2 });
  router.get("/a", () => json({}));
  for (let i = 0; i < 4; i++) await fetch(new Request("http://localhost/a"));

  const res = await fetch(new Request("http://localhost/_debugbar"));
  const html = await res.text();
  expect(res.status).toBe(200);
  expect((html.match(/>JSON</g) ?? []).length).toBe(2);
});

test("except paths are not recorded", async () => {
  const { router, fetch } = await boot({ enabled: true, except: ["/health"] });
  router.get("/health", () => json({ up: true }));

  const res = await fetch(new Request("http://localhost/health"));
  expect(res.headers.get("X-Debugbar-Id")).toBeNull();
});

test("sanitize masks nested secrets and caps depth", () => {
  const out = sanitize({ user: { api_key: "k", name: "n" }, list: [{ token: "t" }] }) as any;
  expect(out.user.api_key).toBe("********");
  expect(out.user.name).toBe("n");
  expect(out.list[0].token).toBe("********");
});

test("memory store evicts oldest", () => {
  const store = new MemoryDebugbarStore(2);
  for (const id of ["a", "b", "c"]) store.put({ id } as Snapshot);
  expect(store.get("a")).toBeUndefined();
  expect(store.list().map((s) => s.id)).toEqual(["c", "b"]);
});
