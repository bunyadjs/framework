import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer, ToolRegistry } from "@bunyad/mcp";
import { FileDebugbarStore, MemoryDebugbarStore, debugbarTools, type Snapshot } from "../src/index.ts";
import { readPointer, summarize } from "../src/mcp-tools.ts";

let dir: string;
let store: FileDebugbarStore;
let server: McpServer;
let n = 0;

function snapshot(over: Partial<Snapshot> & { path?: string; status?: number; ms?: number } = {}): Snapshot {
  const id = (++n).toString(16).padStart(16, "0");
  return {
    id,
    collectedAt: new Date(Date.now() - 1000 + n).toISOString(),
    request: {
      method: "GET", url: `http://x${over.path ?? "/p"}`, path: over.path ?? "/p", status: over.status ?? 200,
      durationMs: over.ms ?? 12, memoryBytes: 1, ip: null, route: { name: "r", params: {} },
      query: {}, body: {}, headers: {}, cookies: {}, responseHeaders: {},
    },
    queries: { count: 0, totalMs: 0, duplicates: 0, slow: 0, nPlusOne: 0, groups: [], items: [] },
    timeline: [], messages: [], logs: [],
    cache: { hits: 0, misses: 0, writes: 0, items: [] },
    events: { count: 0, unhandled: 0, items: [] },
    exceptions: [],
    ...over,
  } as Snapshot;
}

const nPlusOneSnapshot = () => {
  const items = Array.from({ length: 6 }, (_, i) => ({
    sql: "select * from stock where product_id = ?", bindings: [i], timeMs: 2, at: i, duplicate: false, slow: false,
    nPlusOne: true, repeats: 6, origin: { file: "app/Services/StockService.ts", line: 57, function: "forProducts" },
  }));
  return snapshot({
    path: "/products",
    queries: { count: 6, totalMs: 12, duplicates: 0, slow: 0, nPlusOne: 6, groups: [{ sql: items[0]!.sql, count: 6, totalMs: 12, origin: items[0]!.origin }], items },
  });
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "debugbar-mcp-"));
  store = new FileDebugbarStore(dir);
  const registry = new ToolRegistry();
  for (const tool of debugbarTools(() => store)) registry.register(tool);
  server = new McpServer(registry);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as any;
  const text = res.result.content[0].text as string;
  return { isError: res.result.isError === true, text, json: () => JSON.parse(text) };
}
const seed = async (...items: Snapshot[]) => {
  for (const item of items) store.put(item);
  await store.flush();
};

test("request rows report elapsed query time, with the summed time in the summary", async () => {
  const parallel = snapshot({ queries: { count: 2, totalMs: 10, wallMs: 5, duplicates: 0, slow: 0, nPlusOne: 0, groups: [], items: [] } });
  const oldStored = snapshot({ queries: { count: 1, totalMs: 3, duplicates: 0, slow: 0, nPlusOne: 0, groups: [], items: [] } } as any); // no wallMs
  await seed(parallel, oldStored);
  const rows = (await call("debugbar_list_requests")).json().requests;
  expect(rows.find((r: any) => r.id === parallel.id).queryMs).toBe(5);
  expect(rows.find((r: any) => r.id === oldStored.id).queryMs).toBe(3); // falls back for older snapshots
  expect((await call("debugbar_get_request", { id: parallel.id })).json().queryMsSummed).toBe(10);
  expect((await call("debugbar_queries", { id: parallel.id })).json().summary).toMatchObject({ elapsedMs: 5, summedMs: 10 });
});

test("registers five namespaced tools", () => {
  expect(debugbarTools(() => store).map((t) => t.name)).toEqual([
    "debugbar_list_requests", "debugbar_get_request", "debugbar_queries", "debugbar_exceptions", "debugbar_logs",
  ]);
});

test("list_requests is newest first, compact, and filterable", async () => {
  const slow = snapshot({ path: "/reports", ms: 900 });
  const boom = snapshot({ path: "/boom", status: 500, exceptions: [{ name: "Error", message: "kaput", stack: "s", at: 1 }] });
  await seed(snapshot({ path: "/a" }), slow, boom, nPlusOneSnapshot());

  const all = (await call("debugbar_list_requests")).json();
  expect(all.count).toBe(4);
  expect(Object.keys(all.requests[0]).sort()).toEqual(["at", "events", "exceptions", "id", "kind", "method", "ms", "nPlusOne", "path", "queries", "queryMs", "status"]);

  expect((await call("debugbar_list_requests", { minDurationMs: 500 })).json().requests.map((r: any) => r.path)).toEqual(["/reports"]);
  expect((await call("debugbar_list_requests", { hasExceptions: true })).json().requests.map((r: any) => r.path)).toEqual(["/boom"]);
  expect((await call("debugbar_list_requests", { hasNPlusOne: true })).json().requests.map((r: any) => r.path)).toEqual(["/products"]);
  expect((await call("debugbar_list_requests", { status: 500 })).json().count).toBe(1);
  expect((await call("debugbar_list_requests", { pathContains: "rep" })).json().count).toBe(1);
  expect((await call("debugbar_list_requests", { limit: 2 })).json().count).toBe(2);
});

test("get_request summarizes what is wrong, by id or latest", async () => {
  const bad = nPlusOneSnapshot();
  await seed(bad);
  const out = (await call("debugbar_get_request", { id: bad.id })).json();
  expect(out.issues[0]).toContain("possible N+1: 6×");
  expect(out.issues[0]).toContain("app/Services/StockService.ts:57");
  expect(out.counts.queries).toBe(6);
  expect(out.hint).toContain("sections");
  expect((await call("debugbar_get_request")).json().id).toBe(bad.id); // latest
});

test("get_request returns requested sections, with long SQL cut and stacks trimmed", async () => {
  const long = snapshot({
    queries: { count: 1, totalMs: 1, duplicates: 0, slow: 0, nPlusOne: 0, groups: [], items: [{ sql: "select " + "x".repeat(900), bindings: [], timeMs: 1, at: 0, duplicate: false, slow: false, nPlusOne: false, repeats: 0, origin: null }] },
    exceptions: [{ name: "Error", message: "m", stack: Array.from({ length: 40 }, (_, i) => `at f${i}`).join("\n"), at: 1 }],
  });
  await seed(long);
  const out = (await call("debugbar_get_request", { sections: ["queries", "exceptions"] })).json();
  expect(out.queries.items[0].sql.length).toBeLessThan(330);
  expect(out.queries.items[0].sql).toContain("(+");
  expect(out.exceptions[0].stack.split("\n")).toHaveLength(15);
});

test("get_request pointer returns exactly one value, or says nothing is there", async () => {
  const bad = nPlusOneSnapshot();
  await seed(bad);
  expect((await call("debugbar_get_request", { pointer: "/queries/items/2/bindings" })).json().value).toEqual([2]);
  expect((await call("debugbar_get_request", { pointer: "/nope/nothing" })).json().error).toContain("Nothing at");
  expect(readPointer({ a: { "b/c": [10, 20] } }, "/a/b~1c/1")).toBe(20);
  expect(readPointer({ a: 1 }, "/a/b")).toBeUndefined();
});

test("queries lists N+1 groups first and filters", async () => {
  const bad = nPlusOneSnapshot();
  await seed(bad);
  const all = (await call("debugbar_queries", { id: bad.id, limit: 3 })).json();
  expect(all.nPlusOneGroups[0]).toMatchObject({ count: 6, at: "app/Services/StockService.ts:57" });
  expect(all.queries).toHaveLength(3);
  expect(all.matching).toBe(6);
  expect(all.queries[0].at).toContain("StockService.ts:57");
  expect((await call("debugbar_queries", { id: bad.id, filter: "slow" })).json().matching).toBe(0);
  expect((await call("debugbar_queries", { id: bad.id, filter: "nplusone" })).json().matching).toBe(6);
});

test("exceptions scans recent requests, or one id", async () => {
  const boom = snapshot({ path: "/boom", status: 500, exceptions: [{ name: "TypeError", message: "x is undefined", stack: "TypeError\n at a", at: 1 }] });
  await seed(snapshot(), boom, snapshot());
  const found = (await call("debugbar_exceptions")).json();
  expect(found.count).toBe(1);
  expect(found.exceptions[0]).toMatchObject({ request: boom.id, route: "GET /boom", name: "TypeError" });
  expect((await call("debugbar_exceptions", { id: boom.id })).json().count).toBe(1);
  expect((await call("debugbar_exceptions", { id: "0".repeat(16) })).json().count).toBe(0);
});

test("logs filter by minimum level", async () => {
  const s = snapshot({
    logs: [
      { level: "info", message: "hello", at: 1 },
      { level: "error", message: "bad", at: 2, context: { id: 7 } },
      { level: "warning", message: "careful", at: 3 },
    ],
  });
  await seed(s);
  expect((await call("debugbar_logs", { id: s.id })).json().count).toBe(3);
  const warn = (await call("debugbar_logs", { id: s.id, minLevel: "warning" })).json();
  expect(warn.logs.map((l: any) => l.message).sort()).toEqual(["bad", "careful"]);
  expect(warn.count).toBe(2);
  expect(warn.logs.find((l: any) => l.message === "bad").context).toEqual({ id: 7 });
});

test("empty history and unknown ids give guidance, not errors", async () => {
  expect((await call("debugbar_list_requests")).json().note).toContain("No requests recorded");
  expect((await call("debugbar_get_request", { id: "f".repeat(16) })).json().error).toContain("No request with id");

  const memory = new McpServer(
    (() => {
      const r = new ToolRegistry();
      for (const tool of debugbarTools(() => new MemoryDebugbarStore())) r.register(tool);
      return r;
    })(),
  );
  const res = (await memory.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "debugbar_list_requests", arguments: {} } })) as any;
  expect(res.result.content[0].text).toContain('driver: \\"file\\"');
});

test("bad arguments are reported to the agent", async () => {
  const res = await call("debugbar_list_requests", { limit: 500 });
  expect(res.isError).toBe(true);
  expect(res.text).toContain("arguments.limit must be <= 50");
  expect((await call("debugbar_get_request", { sections: ["nonsense"] })).isError).toBe(true);
});

test("summarize flags 5xx, exceptions, duplicates, slow queries and unhandled events", () => {
  const out = summarize(
    snapshot({
      status: 503,
      exceptions: [{ name: "Error", message: "boom", stack: "", at: 1 }],
      queries: { count: 2, totalMs: 300, duplicates: 2, slow: 1, nPlusOne: 0, groups: [], items: [] },
      events: { count: 1, unhandled: 1, items: [] },
    }),
  );
  expect(out.issues).toEqual(["responded 503", "exception Error: boom", "2 duplicate queries", "1 slow queries", "1 events with no listeners"]);
});

test("another process (`bunyad mcp`) reads history this one wrote to disk", async () => {
  const bad = nPlusOneSnapshot();
  await seed(bad);

  const root = await mkdtemp(join(tmpdir(), "debugbar-mcp-app-"));
  try {
    await mkdir(join(root, "bootstrap"), { recursive: true });
    const u = (name: string) => JSON.stringify(import.meta.resolve(name));
    await writeFile(
      join(root, "bootstrap/app.ts"),
      `import { Application } from ${u("@bunyad/core")};
import { Router } from ${u("@bunyad/router")};
import { DebugbarServiceProvider } from ${u("@bunyad/debugbar")};
export async function createApplication() {
  const app = new Application({ router: new Router(), basePath: ${JSON.stringify(root)}, config: { app: { debug: true, env: "local" }, debugbar: { enabled: true, driver: "file", storagePath: ${JSON.stringify(dir)} } } });
  app.register(DebugbarServiceProvider);
  await app.boot();
}
`,
    );
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../../cli/src/bunyad.ts"), "mcp"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "debugbar_get_request", arguments: { id: "latest" } } });
    child.stdin.end();

    const stdout = await new Response(child.stdout).text();
    await child.exited;
    const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
    const byId = (id: number) => messages.find((m) => m.id === id);
    expect(byId(2).result.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(["debugbar_list_requests", "debugbar_get_request", "debugbar_queries", "debugbar_exceptions", "debugbar_logs", "mcp_info"]));
    const summary = JSON.parse(byId(3).result.content[0].text);
    expect(summary.id).toBe(bad.id);
    expect(summary.issues[0]).toContain("possible N+1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
