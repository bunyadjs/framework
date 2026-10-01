import type { Database } from "bun:sqlite";
import { pathnameOf } from "@bunyad/core";

export const BENCH_HELLO = { message: "Hello, World" } as const;

export type BenchSqlite = {
  select: { get: (...params: unknown[]) => unknown };
  insert: {
    run: (...params: unknown[]) => { lastInsertRowid: number | bigint };
  };
};

/** Prepared statements for the Bun-core `/bench/bun/*` routes. */
export function prepareBenchSqlite(db: Database): BenchSqlite {
  return {
    select: db.query("SELECT id, name FROM bench_items WHERE id = ?"),
    insert: db.query("INSERT INTO bench_items (name) VALUES (?)"),
  };
}

export function seedBenchSqlite(db: Database): void {
  const row = db.query("SELECT id FROM bench_items WHERE id = 1").get();
  if (!row) {
    db.run("INSERT INTO bench_items (name) VALUES (?)", ["hello"]);
  }
}

/** Fast-path Bun.serve handlers — skip the kernel entirely. */
export function bunBenchResponse(
  request: Request,
  sqlite: BenchSqlite,
): Response | null {
  const path = pathnameOf(request.url);
  if (path === "/bench/bun/hello") {
    return Response.json(BENCH_HELLO);
  }
  if (path === "/bench/bun/select") {
    return Response.json(sqlite.select.get(1));
  }
  if (request.method === "POST" && path === "/bench/bun/insert") {
    const result = sqlite.insert.run("hello");
    return Response.json({ id: Number(result.lastInsertRowid) });
  }
  return null;
}
