import { expect, test } from "bun:test";
import { Application, createFetchHandler } from "@bunyad/core";
import { fireQueryExecuted } from "@bunyad/database";
import { json } from "@bunyad/http";
import { Log, setLogChannel } from "@bunyad/log";
import { Router } from "@bunyad/router";
import { Schedule, schedule, setSchedule, setScheduleMutexStore } from "@bunyad/schedule";
import { McpServer, ToolRegistry } from "@bunyad/mcp";
import {
  Debugbar,
  DebugbarServiceProvider,
  MemoryDebugbarStore,
  activeDebugbar,
  debugbarTools,
  type Snapshot,
} from "../src/index.ts";

async function boot(debugbar: Record<string, unknown> = { enabled: true }, app: Record<string, unknown> = {}) {
  const router = new Router();
  const application = new Application({ router, config: { app: { port: 0, ...app }, debugbar } });
  application.register(DebugbarServiceProvider);
  await application.boot();
  const store = () => activeDebugbar()!.store as MemoryDebugbarStore;
  return { router, fetch: createFetchHandler(application), store };
}

const connection = {} as never;
const fire = (sql: string, bindings: unknown[] = [], timeMs = 1) => fireQueryExecuted({ sql, bindings, timeMs, connection });

test("profile() records a job as its own history entry with queries, logs and messages", async () => {
  const { store } = await boot();
  setLogChannel({ log() {} });

  const result = await Debugbar.profile("SendReceipt", async () => {
    fire("select * from orders where id = ?", [7]);
    Log.info("receipt sent");
    Debugbar.message("to customer");
    return "done";
  });

  expect(result).toBe("done");
  const [entry] = (await store().list()) as Snapshot[];
  expect(entry).toMatchObject({ kind: "job" });
  expect(entry!.request).toMatchObject({ method: "JOB", path: "SendReceipt", status: 200 });
  expect(entry!.queries.count).toBe(1);
  expect(entry!.logs[0]).toMatchObject({ message: "receipt sent" });
  expect(entry!.messages[0]).toMatchObject({ message: "to customer" });
});

test("a failing job is recorded with its error, masked, and the error still propagates", async () => {
  const { store } = await boot();
  await expect(
    Debugbar.profile("Charge", () => {
      throw new Error("gateway said api_key=sk_live_ABCDEF rejected");
    }),
  ).rejects.toThrow("gateway said");

  const [entry] = (await store().list()) as Snapshot[];
  expect(entry!.request.status).toBe(500);
  expect(entry!.exceptions[0]!.message).toContain("api_key=********");
  expect(JSON.stringify(entry)).not.toContain("sk_live_ABCDEF");
});

test("queries inside separate jobs are not mixed up, even when they overlap", async () => {
  const { store } = await boot();
  await Promise.all([
    Debugbar.profile("A", async () => {
      fire("select 'a'");
      await Bun.sleep(5);
      fire("select 'a2'");
    }),
    Debugbar.profile("B", async () => {
      await Bun.sleep(2);
      fire("select 'b'");
    }),
  ]);
  const entries = (await store().list()) as Snapshot[];
  const byName = Object.fromEntries(entries.map((e) => [e.request.path, e.queries.count]));
  expect(byName).toEqual({ A: 2, B: 1 });
});

test("inside a request, profile() adds a timeline span instead of a new entry", async () => {
  const { router, fetch, store } = await boot();
  router.get("/work", async () => {
    await Debugbar.profile("inline-job", async () => {
      fire("select 1");
    });
    return json({});
  });
  const res = await fetch(new Request("http://localhost/work"));
  expect(res.status).toBe(200);

  const entries = (await store().list()) as Snapshot[];
  expect(entries).toHaveLength(1);
  expect(entries[0]!.kind).toBe("http");
  expect(entries[0]!.timeline.map((t) => t.label)).toEqual(["inline-job"]);
  expect(entries[0]!.queries.count).toBe(1);
});

test("profile() just runs the work when the bar is off, and honours `except`", async () => {
  await boot({ enabled: false });
  expect(activeDebugbar()).toBeUndefined();
  expect(await Debugbar.profile("x", () => 42)).toBe(42);
  await expect(Debugbar.profile("x", () => Promise.reject(new Error("still thrown")))).rejects.toThrow("still thrown");

  const { store } = await boot({ enabled: true, except: ["heartbeat"] });
  await Debugbar.profile("heartbeat:ping", () => undefined);
  await Debugbar.profile("real", () => undefined);
  expect(((await store().list()) as Snapshot[]).map((e) => e.request.path)).toEqual(["real"]);
});

test("a store that fails does not fail the job", async () => {
  await boot({
    enabled: true,
    store: { put() { throw new Error("disk full"); }, get: () => undefined, list: () => [], clear() {} },
  });
  expect(await Debugbar.profile("job", () => "ok")).toBe("ok");
});

test("scheduled tasks are recorded automatically, with their queries and failures", async () => {
  const { store } = await boot();
  setScheduleMutexStore(undefined);
  const s = new Schedule();
  setSchedule(s);

  schedule()
    .call(async () => {
      fire("select count(*) from products");
      Log.info("report built");
    })
    .everyMinute()
    .name("reports:nightly");

  await s.run(new Date(2026, 0, 1, 10, 5, 0));
  const [ran] = (await store().list()) as Snapshot[];
  expect(ran).toMatchObject({ kind: "schedule" });
  expect(ran!.request).toMatchObject({ method: "SCHEDULE", path: "reports:nightly", status: 200 });
  expect(ran!.queries.count).toBe(1);

  const s2 = new Schedule();
  setSchedule(s2);
  schedule()
    .call(() => {
      throw new Error("kaput");
    })
    .everyMinute()
    .name("reports:broken");
  await expect(s2.run(new Date(2026, 0, 1, 10, 6, 0))).rejects.toThrow("kaput");
  const failed = ((await store().list()) as Snapshot[]).find((e) => e.request.path === "reports:broken")!;
  expect(failed.request.status).toBe(500);
  expect(failed.exceptions[0]).toMatchObject({ message: "kaput" });
});

test("the MCP list tool filters by kind and labels each row", async () => {
  const { store } = await boot();
  const { router, fetch } = await boot();
  router.get("/page", () => json({}));
  await fetch(new Request("http://localhost/page"));
  await Debugbar.profile("SendReceipt", () => undefined);
  await Debugbar.profile("Cleanup", () => undefined, { kind: "command" });

  const registry = new ToolRegistry();
  for (const tool of debugbarTools(() => activeDebugbar()!.store)) registry.register(tool);
  const server = new McpServer(registry);
  const list = async (args: Record<string, unknown>) =>
    JSON.parse(((await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "debugbar_list_requests", arguments: args } })) as any).result.content[0].text);

  expect((await list({})).requests.map((r: any) => r.kind).sort()).toEqual(["command", "http", "job"]);
  const jobs = (await list({ kind: "job" })).requests;
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ kind: "job", method: "JOB", path: "SendReceipt" });
  expect((await list({ kind: "schedule" })).count).toBe(0);
  void store;
});
