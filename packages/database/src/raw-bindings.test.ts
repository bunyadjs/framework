import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { QueryBuilder, connectPostgres, connectSqlite, schemaFor, sql, type Connection } from "./index.ts";

const connections: Array<[string, Connection]> = [["sqlite", connectSqlite()]];
const pg = Bun.env.BUNYAD_TEST_POSTGRES_URL;
if (pg && /^(postgres|postgresql):\/\//i.test(pg)) {
  connections.push(["postgres", connectPostgres({ url: pg, max: 2 })]);
}

describe.each(connections)("query builder raw bindings (%s)", (_name, c) => {
  const table = (name: string) => new QueryBuilder(c, name);
  beforeAll(async () => {
    const schema = schemaFor(c);
    await schema.dropIfExists("qbr_b");
    await schema.dropIfExists("qbr_a");
    await schema.create("qbr_a", (t) => {
      t.id();
      t.integer("n");
    });
    await schema.create("qbr_b", (t) => {
      t.id();
      t.integer("a_id");
      t.string("label");
    });
    for (const n of [1, 2, 3, 4, 5, 6]) await c.run("INSERT INTO qbr_a (n) VALUES (?)", [n]);
    await c.run("INSERT INTO qbr_b (a_id, label) VALUES (?, ?), (?, ?), (?, ?)", [1, "x", 2, "x", 3, "y"]);
  });
  afterAll(async () => {
    const schema = schemaFor(c);
    await schema.dropIfExists("qbr_b");
    await schema.dropIfExists("qbr_a");
  });

  const ids = (rows: unknown[]): number[] => rows.map((row) => Number((row as { id: number }).id));

  test("a union's outer ORDER BY keeps its bindings after those of every part", async () => {
    const first = table("qbr_a").selectRaw("id, n").whereRaw("n <= ?", [2]);
    const second = table("qbr_a").selectRaw("id, n").whereRaw("n >= ?", [5]);
    const rows = await first.union(second).orderByRaw("CASE WHEN n = ? THEN 0 ELSE 1 END, id", [5]).get();
    expect(ids(rows.all())).toEqual([5, 1, 2, 6]);
  });

  test("a clone keeps order and group bindings, and changing the clone leaves the original alone", async () => {
    const original = table("qbr_a").orderByRaw("CASE WHEN n > ? THEN 0 ELSE 1 END, id", [4]);
    const copy = original.clone().orderByRaw("id");
    expect(ids((await original.get()).all())).toEqual([5, 6, 1, 2, 3, 4]);
    expect(ids((await copy.get()).all())).toEqual([5, 6, 1, 2, 3, 4]);
  });

  test("count() on a grouped or ordered query ignores their bindings", async () => {
    const query = table("qbr_a")
      .whereRaw("n >= ?", [2])
      .groupByRaw("(n > ?)", [4])
      .orderByRaw("CASE WHEN n > ? THEN 0 ELSE 1 END", [3]);
    expect(Number(await query.count())).toBe(5);
    // the grouped query itself still runs with its bindings
    const grouped = table("qbr_a").selectRaw("COUNT(*) AS n").whereRaw("n >= ?", [2]).groupByRaw("(n > ?)", [4]);
    expect((await grouped.get()).all()).toHaveLength(2);
  });

  test("joinRaw keeps its place among joins and its bindings ahead of the where bindings", async () => {
    const rows = await table("qbr_a")
      .selectRaw("qbr_a.id AS id")
      .join("qbr_b", "qbr_b.a_id", "=", "qbr_a.id")
      .joinRaw("INNER JOIN qbr_b AS b2 ON b2.a_id = qbr_a.id AND b2.label = ?", ["x"])
      .whereRaw("qbr_a.n >= ?", [2])
      .orderByRaw("qbr_a.id")
      .get();
    expect(ids(rows.all())).toEqual([2]);
  });

  test("a fragment and bindings together are refused, and a non-fragment object is too", () => {
    expect(() => table("qbr_a").whereRaw(sql`n > ${1}`, [2])).toThrow(/inside the sql/);
    expect(() => table("qbr_a").whereRaw({ nope: true } as never)).toThrow(/string or a sql/);
  });

  test("an empty list of bindings is the same as none", async () => {
    const rows = await table("qbr_a").whereRaw("n = 3", []).orderByRaw("id", []).get();
    expect(ids(rows.all())).toEqual([3]);
  });
});
