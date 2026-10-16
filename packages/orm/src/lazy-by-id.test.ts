/**
 * Regression (sitemap T0.3): static `Model.lazyById` streams by keyset pages.
 * Query budget: a page smaller than the chunk ends iteration, so
 * n rows issue floor(n / chunk) + 1 SELECTs (= ceil(n / chunk) + 1 when the
 * last page is full and an empty page confirms the end).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { listen, schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class LbPost extends Model {
  static table = "lb_posts";
  static fillable = ["title"];
  declare id: number;
  declare title: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "static Model.lazyById (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const TOTAL = 2500;

    async function selects(fn: () => Promise<unknown>): Promise<string[]> {
      const seen: string[] = [];
      const off = listen((e) => {
        if (/^\s*SELECT/i.test(e.sql)) seen.push(e.sql);
      });
      try {
        await fn();
      } finally {
        off();
      }
      return seen;
    }

    async function collectIds(
      chunk: number,
      limitRows?: number,
    ): Promise<number[]> {
      const ids: number[] = [];
      const query =
        limitRows === undefined
          ? LbPost.lazyById(chunk)
          : LbPost.where("id", "<=", limitRows).lazyById(chunk);
      for await (const post of query) ids.push(post.id);
      return ids;
    }

    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      await schema.dropIfExists("lb_posts");
      await schema.create("lb_posts", (b) => {
        b.id();
        b.string("title");
      });
      for (let i = 0; i < TOTAL; i += 250) {
        const rows = Array.from(
          { length: Math.min(250, TOTAL - i) },
          (_, j) => `p${i + j}`,
        );
        await c.run(
          `INSERT INTO lb_posts (title) VALUES ${rows.map(() => "(?)").join(",")}`,
          rows,
        );
      }
    });

    afterAll(async () => {
      await schemaFor(c).dropIfExists("lb_posts");
    });

    test("yields every row once, in id order", async () => {
      const ids = await collectIds(1000);
      expect(ids).toHaveLength(TOTAL);
      expect(ids).toEqual(Array.from({ length: TOTAL }, (_, i) => i + 1));
    });

    test("full last page: ceil(n/1000)+1 queries (2000 rows → 3)", async () => {
      let ids: number[] = [];
      const sql = await selects(async () => {
        ids = await collectIds(1000, 2000);
      });
      expect(ids).toHaveLength(2000);
      expect(sql).toHaveLength(Math.ceil(2000 / 1000) + 1);
    });

    test("partial last page ends without an extra query (2500 rows → 3)", async () => {
      const sql = await selects(() => collectIds(1000));
      expect(sql).toHaveLength(Math.floor(TOTAL / 1000) + 1);
    });

    test("chunk boundaries 999 / 1000 / 1001", async () => {
      for (const [n, expected] of [
        [999, 1],
        [1000, 2],
        [1001, 2],
      ] as const) {
        let ids: number[] = [];
        const sql = await selects(async () => {
          ids = await collectIds(1000, n);
        });
        expect(ids).toHaveLength(n);
        expect(sql).toHaveLength(expected);
      }
    });

    test("keyset paging: no OFFSET", async () => {
      const sql = await selects(() => collectIds(1000));
      for (const s of sql) expect(s).not.toMatch(/\bOFFSET\b/i);
    });

    test("zero rows: one query", async () => {
      const sql = await selects(() => collectIds(1000, 0));
      expect(sql).toHaveLength(1);
    });
  },
);
