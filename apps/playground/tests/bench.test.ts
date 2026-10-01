import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import BenchItem from "../app/Models/BenchItem.ts";
import {
  BENCH_HELLO,
  bunBenchResponse,
  prepareBenchSqlite,
  seedBenchSqlite,
} from "../app/Support/bench-routes.ts";
import { bootApp } from "./helpers.ts";

test("GET /bench/hello returns hello world json", async () => {
  const { fetch } = await bootApp();
  const res = await fetch(new Request("http://localhost/bench/hello"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(BENCH_HELLO);
});

test("GET /bench/select returns the seeded row via ORM", async () => {
  const { fetch } = await bootApp();
  await BenchItem.create({ name: "hello" });
  const res = await fetch(new Request("http://localhost/bench/select"));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ id: 1, name: "hello" });
});

test("POST /bench/insert creates a row via ORM", async () => {
  const { fetch } = await bootApp();
  const res = await fetch(
    new Request("http://localhost/bench/insert", { method: "POST" }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: number };
  expect(body.id).toBeGreaterThan(0);
  const row = await BenchItem.find(body.id);
  expect(row?.name).toBe("hello");
});

test("Bun.serve bench routes return hello / select / insert json", async () => {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE bench_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)",
  );
  seedBenchSqlite(db);
  const sqlite = prepareBenchSqlite(db);

  const hello = bunBenchResponse(
    new Request("http://localhost/bench/bun/hello"),
    sqlite,
  )!;
  expect(await hello.json()).toEqual(BENCH_HELLO);

  const select = bunBenchResponse(
    new Request("http://localhost/bench/bun/select"),
    sqlite,
  )!;
  expect(await select.json()).toEqual({ id: 1, name: "hello" });

  const insert = bunBenchResponse(
    new Request("http://localhost/bench/bun/insert", { method: "POST" }),
    sqlite,
  )!;
  expect(await insert.json()).toEqual({ id: 2 });
});
