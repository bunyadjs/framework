import { afterEach, expect, test } from "bun:test";
import { clearQueryListeners, fireQueryExecuted } from "@bunyad/database";
import { registerDumpQueryListener } from "./DumpServiceProvider.ts";

afterEach(() => {
  clearQueryListeners();
  delete process.env.FLOCK_DUMP_URL;
});

test("query listener is idle without a dump URL", () => {
  delete process.env.FLOCK_DUMP_URL;
  expect(registerDumpQueryListener()).toBeUndefined();
});

test("query listener posts sql when a dump URL is set", async () => {
  process.env.FLOCK_DUMP_URL = "http://127.0.0.1:7979/v1/ingest";
  const posts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    posts.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const stop = registerDumpQueryListener();
    expect(stop).toBeTypeOf("function");
    fireQueryExecuted({
      sql: "select 1",
      bindings: [1],
      timeMs: 1.25,
      connection: {} as never,
    });
    await Bun.sleep(20);
    expect(posts.some((body) => body.includes("select 1"))).toBe(true);
    expect(posts.some((body) => body.includes('"kind":"query"'))).toBe(true);
    stop?.();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
