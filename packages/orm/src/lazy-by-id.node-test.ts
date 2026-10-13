/**
 * Node mirror of lazy-by-id.test.ts (sitemap T0.3) on better-sqlite3.
 * Run via packages/database `test:node`.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  connectSqlite,
  listen,
  schemaFor,
  type Connection,
} from "@bunyad/database";
import { Model } from "./index.ts";

class LbNodePost extends Model {
  static table = "lb_node_posts";
  static fillable = ["title"];
  declare id: number;
}

describe("static Model.lazyById (node sqlite)", () => {
  let c: Connection;

  async function run(
    limitRows: number,
  ): Promise<{ ids: number[]; selects: number }> {
    let selects = 0;
    const off = listen((e) => {
      if (/^\s*SELECT/i.test(e.sql)) selects++;
    });
    const ids: number[] = [];
    try {
      for await (const post of LbNodePost.where("id", "<=", limitRows).lazyById(
        1000,
      )) {
        ids.push(post.id);
      }
    } finally {
      off();
    }
    return { ids, selects };
  }

  before(async () => {
    c = connectSqlite({ path: ":memory:" });
    Model.setConnection(c);
    await schemaFor(c).create("lb_node_posts", (b) => {
      b.id();
      b.string("title");
    });
    const rows = Array.from({ length: 250 }, (_, i) => `p${i}`);
    for (let i = 0; i < 2500; i += 250) {
      await c.run(
        `INSERT INTO lb_node_posts (title) VALUES ${rows.map(() => "(?)").join(",")}`,
        rows,
      );
    }
  });

  after(async () => {
    await c.close();
  });

  it("issues ceil(n/1000)+1 queries for a full last page and yields rows in order", async () => {
    const { ids, selects } = await run(2000);
    assert.equal(ids.length, 2000);
    assert.deepEqual(ids.slice(0, 3), [1, 2, 3]);
    assert.equal(ids[1999], 2000);
    assert.equal(selects, 3);
  });

  it("partial last page ends without an extra query", async () => {
    const { ids, selects } = await run(2500 - 1);
    assert.equal(ids.length, 2499);
    assert.equal(selects, 3);
  });
});
