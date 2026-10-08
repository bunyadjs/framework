/**
 * Large-table behaviour: 100k rows must stream, page and aggregate correctly without loading the
 * table into memory. Time limits are deliberately loose (several times what a laptop needs) so
 * they only catch algorithmic regressions such as a quadratic loop or an N+1, not noise.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();
const ROWS = 100_000;
const CHUNK = 5_000;

class ScRow extends Model {
  static table = "sc_rows";
  static fillable = ["group_id", "amount", "label"];
  static casts() { return { amount: "integer" as const }; }
  declare id: number;
  declare group_id: number;
  declare amount: number;
  declare label: string;
}
class ScGroup extends Model {
  static table = "sc_groups";
  static fillable = ["name"];
  declare id: number;
  rows() { return this.hasMany(ScRow, "group_id"); }
}

async function within<T>(ms: number, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await run();
  const took = performance.now() - start;
  expect(took).toBeLessThan(ms);
  return result;
}

describe.each(drivers.map((d) => [d.name, d] as const))("100k-row table (%s)", (_name, driver) => {
  const c = driver.connection;

  beforeAll(async () => {
    Model.setConnection(c);
    const schema = schemaFor(c);
    for (const t of ["sc_rows", "sc_groups"]) await schema.dropIfExists(t);
    await schema.create("sc_groups", (b) => { b.id(); b.string("name"); b.timestamps(); });
    await schema.create("sc_rows", (b) => {
      b.id(); b.integer("group_id"); b.integer("amount"); b.string("label"); b.timestamps();
      b.index("group_id");
    });
    await ScGroup.query().insert(Array.from({ length: 100 }, (_, i) => ({ name: `g${i}` })));
  }, 60_000);
  afterAll(async () => {
    const schema = schemaFor(c);
    for (const t of ["sc_rows", "sc_groups"]) await schema.dropIfExists(t);
  });

  test("bulk insert of 100k rows", async () => {
    await within(60_000, async () => {
      for (let start = 0; start < ROWS; start += CHUNK) {
        await ScRow.query().insert(
          Array.from({ length: CHUNK }, (_, i) => {
            const n = start + i + 1;
            return { group_id: (n % 100) + 1, amount: n % 1000, label: `row-${n}` };
          }),
        );
      }
    });
    expect(await ScRow.count()).toBe(ROWS);
  }, 120_000);

  test("aggregates over the whole table", async () => {
    const [sum, max, grouped] = await within(10_000, () =>
      Promise.all([
        ScRow.sum("amount"),
        ScRow.max("amount"),
        ScRow.query().where("group_id", 7).count(),
      ]),
    );
    expect(sum).toBe(49_950_000);
    expect(Number(max)).toBe(999);
    expect(grouped).toBe(ROWS / 100);
  });

  test("chunkById visits every row exactly once", async () => {
    let seen = 0;
    let lastId = 0;
    let ordered = true;
    await within(30_000, () =>
      ScRow.query().chunkById(2_000, (rows) => {
        for (const row of rows.all()) {
          if (row.id <= lastId) ordered = false;
          lastId = row.id;
          seen += 1;
        }
      }),
    );
    expect(seen).toBe(ROWS);
    expect(ordered).toBe(true);
  }, 60_000);

  test("cursor streams every row without holding them", async () => {
    let seen = 0;
    let total = 0;
    await within(30_000, async () => {
      for await (const row of ScRow.query().cursor(2_000)) {
        seen += 1;
        total += row.amount;
      }
    });
    expect(seen).toBe(ROWS);
    expect(total).toBe(49_950_000);
  }, 60_000);

  test("lazyById pages by key", async () => {
    let seen = 0;
    await within(30_000, async () => {
      for await (const _row of ScRow.query().lazyById(5_000)) seen += 1;
    });
    expect(seen).toBe(ROWS);
  }, 60_000);

  test("offset pagination deep into the table", async () => {
    const page = await within(5_000, () => ScRow.query().orderBy("id").paginate(50, 1_900));
    expect(page.total).toBe(ROWS);
    expect(page.items.length).toBe(50);
    expect(page.items[0]!.id).toBe((1_900 - 1) * 50 + 1);
  });

  test("cursor pagination walks the whole table by key", async () => {
    let page = await ScRow.query().orderBy("id").cursorPaginate(1_000);
    let pages = 1;
    let rows = page.items.length;
    while (page.options.nextCursor && pages < 200) {
      page = await ScRow.query().orderBy("id").cursorPaginate(1_000, page.options.nextCursor);
      pages += 1;
      rows += page.items.length;
    }
    expect(rows).toBe(ROWS);
    expect(pages).toBe(ROWS / 1_000);
  }, 60_000);

  test("pluck and eager loading stay linear", async () => {
    const labels = await within(10_000, () => ScRow.query().where("group_id", 3).pluck("label"));
    expect(labels.count()).toBe(ROWS / 100);
    const groups = await within(10_000, () => ScGroup.with("rows").get());
    expect(groups.count()).toBe(100);
    const first = groups.first() as unknown as { rows: { count(): number } };
    expect(first.rows.count()).toBe(ROWS / 100);
  });

  test("bulk update and delete over many rows", async () => {
    const updated = await within(30_000, () => ScRow.query().where("group_id", 1).update({ amount: 5 }));
    expect(Number(updated)).toBe(ROWS / 100);
    const deleted = await within(30_000, () => ScRow.query().where("group_id", 2).delete());
    expect(Number(deleted)).toBe(ROWS / 100);
    expect(await ScRow.count()).toBe(ROWS - ROWS / 100);
  }, 60_000);
});
