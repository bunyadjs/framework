import { expect, test, beforeEach } from "bun:test";
import { Router } from "@bunyad/router";
import {
  Metrics,
  MemoryMetricsStore,
  MetricsController,
  registerMetricsRoutes,
} from "../src/index.ts";

beforeEach(() => {
  Metrics.restore();
});

test("record aggregators and ingest into memory store", async () => {
  Metrics.record("user_sale", "42", 10).sum().count();
  Metrics.record("user_sale", "42", 5).sum();
  await Metrics.ingest();

  const entries = Metrics.store().entries("user_sale");
  expect(entries).toHaveLength(2);
  expect(entries[0]!.aggregations).toContain("sum");
  expect(entries[0]!.aggregations).toContain("count");
  expect(entries[0]!.value).toBe(10);
});

test("set stores string values", async () => {
  Metrics.set("app_version", "current", "1.0.0");
  await Metrics.ingest();
  const values = Metrics.store().values("app_version");
  expect(values[0]!.value).toBe("1.0.0");
});

test("lazy runs on ingest", async () => {
  let ran = false;
  Metrics.lazy(() => {
    ran = true;
    Metrics.record("lazy", "ok", 1).count();
  });
  expect(ran).toBe(false);
  await Metrics.ingest();
  expect(ran).toBe(true);
  expect(Metrics.store().entries("lazy")).toHaveLength(1);
});

test("filter drops entries", async () => {
  Metrics.filter((e) => !("value" in e && e.type === "noise"));
  Metrics.record("noise", "x", 1).count();
  Metrics.record("keep", "y", 2).count();
  await Metrics.ingest();
  expect(Metrics.store().entries()).toHaveLength(1);
  expect(Metrics.store().entries()[0]!.type).toBe("keep");
});

test("report records exception", async () => {
  Metrics.report(new Error("boom"));
  await Metrics.ingest();
  expect(Metrics.store().entries("exception")).toHaveLength(1);
  expect(Metrics.store().values("exception_message")[0]!.value).toBe("boom");
});

test("fake swaps store", async () => {
  const store = new MemoryMetricsStore();
  const fake = Metrics.fake();
  fake.useStore(store);
  Metrics.record("t", "k", 1).count();
  await Metrics.ingest();
  expect(store.entries()).toHaveLength(1);
});

test("ignore discards buffer", async () => {
  Metrics.record("t", "k", 1).count();
  Metrics.ignore();
  await Metrics.ingest();
  expect(Metrics.store().entries()).toHaveLength(0);
});

test("aggregate rolls up ingested entries", async () => {
  Metrics.record("user_sale", "42", 10).sum().count();
  Metrics.record("user_sale", "42", 5).sum().count();
  await Metrics.ingest();
  const rows = Metrics.aggregate("user_sale");
  expect(rows).toHaveLength(1);
  expect(rows[0]!.count).toBe(2);
  expect(rows[0]!.sum).toBe(15);
  expect(rows[0]!.avg).toBe(7.5);
});

test("html dashboard includes aggregates", async () => {
  Metrics.record("hits", "/", 1).count();
  await Metrics.ingest();
  const html = Metrics.html("Metrics");
  expect(html).toContain("<title>Metrics</title>");
  expect(html).toContain("hits");
  expect(html).toContain("<table>");
});

test("Redis ingest buffers until work drains into store", async () => {
  const { RedisMetricsIngest } = await import("../src/redis-ingest.ts");
  const { MemoryMetricsStore } = await import("../src/memory-store.ts");

  const kv = new Map<string, string>();
  const client = {
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async set(key: string, value: string) {
      kv.set(key, value);
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) {
        if (kv.delete(k)) n += 1;
      }
      return n;
    },
  };

  const store = new MemoryMetricsStore();
  Metrics.useStore(store);
  Metrics.useIngest(new RedisMetricsIngest({ client }));

  Metrics.record("hits", "/api", 1).count();
  await Metrics.ingest();
  expect(store.entries()).toHaveLength(0);
  expect(await Metrics.work()).toBe(1);
  expect(store.entries("hits")).toHaveLength(1);
});

test("RedisMetricsStore persists entries", async () => {
  const { RedisMetricsStore } = await import("../src/redis-store.ts");
  const kv = new Map<string, string>();
  const client = {
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async set(key: string, value: string) {
      kv.set(key, value);
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) {
        if (kv.delete(k)) n += 1;
      }
      return n;
    },
  };

  const store = new RedisMetricsStore({ client });
  await store.refresh();
  Metrics.useStore(store);
  Metrics.useIngest(null);
  Metrics.record("redis", "k", 3).sum();
  await Metrics.ingest();
  expect(store.entries("redis")[0]!.value).toBe(3);
});

test("RequestsRecorder records slow requests", async () => {
  const { RequestsRecorder } = await import("../src/recorders.ts");
  const recorder = new RequestsRecorder({ slowThresholdMs: 50 });
  recorder.record({
    method: "GET",
    path: "/slow",
    durationMs: 120,
    userId: 7,
  });
  recorder.record({ method: "GET", path: "/pulse", durationMs: 200 });
  await Metrics.ingest();
  expect(Metrics.store().entries("request").length).toBeGreaterThan(0);
  expect(Metrics.store().entries("slow_request")).toHaveLength(1);
  expect(Metrics.store().entries("user_request")[0]!.key).toBe("7");
});

test("ServersRecorder and ExceptionsRecorder", async () => {
  const { ServersRecorder, ExceptionsRecorder } = await import(
    "../src/recorders.ts"
  );
  new ServersRecorder().record({
    name: "web-1",
    cpu: 42,
    memory: 61,
  });
  new ExceptionsRecorder().record(new Error("nope"), { class: "AppError" });
  await Metrics.ingest();
  expect(Metrics.store().entries("server_cpu")[0]!.value).toBe(42);
  expect(Metrics.store().entries("exception_class")[0]!.key).toBe("AppError");
});

test("Metrics.routes registers dashboard and aggregates", async () => {
  Metrics.record("hit", "a", 1).count();
  await Metrics.ingest();

  const router = new Router();
  Metrics.routes(router, { path: "/pulse", title: "Metrics Test" });
  const routes = router.getRoutes();
  expect(routes.some((r) => r.uri === "/pulse" && r.name === "pulse.dashboard")).toBe(true);
  expect(
    routes.some((r) => r.uri === "/pulse/aggregates" && r.name === "pulse.aggregates"),
  ).toBe(true);

  const controller = new MetricsController();
  const dash = await controller.dashboard();
  expect(dash.headers.get("Content-Type")).toContain("text/html");
  expect(await dash.text()).toContain("Metrics Test");

  const agg = await controller.aggregates();
  const json = (await agg.json()) as { aggregates: unknown[] };
  expect(Array.isArray(json.aggregates)).toBe(true);
  expect(json.aggregates.length).toBeGreaterThan(0);
});
