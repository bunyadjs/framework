import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_MAX_PER_PAGE, setMaxPerPage } from "@bunyad/common";
import { QueryBuilder, schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class PlRow extends Model {
  static table = "pl_rows";
  static fillable = ["n"];
  declare id: number;
}

class PlSmall extends Model {
  static table = "pl_rows";
  static fillable = ["n"];
  static maxPerPage = 10;
  declare id: number;
}

class PlBig extends Model {
  static table = "pl_rows";
  static fillable = ["n"];
  static maxPerPage = 500;
  declare id: number;
}

const ROWS = 250;

afterEach(() => setMaxPerPage(DEFAULT_MAX_PER_PAGE));

describe.each(drivers.map((d) => [d.name, d] as const))("page size limit (%s)", (_name, driver) => {
  const c = driver.connection;

  beforeAll(async () => {
    Model.setConnection(c);
    const schema = schemaFor(c);
    await schema.dropIfExists("pl_rows");
    await schema.create("pl_rows", (b) => {
      b.id();
      b.integer("n");
      b.timestamps();
    });
    const ts = "2026-01-01 00:00:00";
    for (let i = 0; i < ROWS; i += 50) {
      const chunk = Array.from({ length: 50 }, (_, k) => i + k + 1);
      await c.run(
        `INSERT INTO pl_rows (n, created_at, updated_at) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")}`,
        chunk.flatMap((n) => [n, ts, ts]),
      );
    }
  });
  afterAll(async () => {
    await schemaFor(c).dropIfExists("pl_rows");
  });

  describe("the model query", () => {
    test("paginate gives at most the limit, however much is asked for", async () => {
      const page = await PlRow.newQuery().orderBy("id").paginate(1_000_000);
      expect(page.items.length).toBe(100);
      expect(page.perPage).toBe(100);
      expect(page.total).toBe(ROWS);
      expect(page.lastPage()).toBe(3);
    });

    test("later pages use the clamped size", async () => {
      const page = await PlRow.newQuery().orderBy("id").paginate(1_000_000, 3);
      expect(page.items.length).toBe(50);
      expect(Number((page.items[0] as unknown as { n: number }).n)).toBe(201);
    });

    test("simplePaginate and cursorPaginate are limited too", async () => {
      const simple = await PlRow.newQuery().orderBy("id").simplePaginate(1_000_000);
      expect(simple.pageItems().length).toBe(100);
      expect(simple.perPage).toBe(100);
      expect(simple.hasMorePages()).toBe(true);
      const cursor = await PlRow.newQuery().orderBy("id").cursorPaginate(1_000_000);
      expect(cursor.items.length).toBe(100);
    });

    test("sizes inside the limit, and the default, are unchanged", async () => {
      expect((await PlRow.newQuery().orderBy("id").paginate(25)).items.length).toBe(25);
      expect((await PlRow.newQuery().orderBy("id").paginate()).items.length).toBe(15);
      expect((await PlRow.newQuery().orderBy("id").paginate(100)).items.length).toBe(100);
    });

    test("nonsense sizes fall back or become 1 as before", async () => {
      expect((await PlRow.newQuery().orderBy("id").paginate(Number.NaN)).items.length).toBe(15);
      expect((await PlRow.newQuery().orderBy("id").paginate(-4)).items.length).toBe(1);
      expect((await PlRow.newQuery().orderBy("id").paginate("30" as unknown as number)).items.length).toBe(30);
    });

    test("the application-wide limit can be changed", async () => {
      setMaxPerPage(20);
      expect((await PlRow.newQuery().orderBy("id").paginate(1000)).items.length).toBe(20);
      setMaxPerPage(1000);
      expect((await PlRow.newQuery().orderBy("id").paginate(1000)).items.length).toBe(ROWS);
    });

    test("a model can lower or raise its own limit", async () => {
      expect((await PlSmall.newQuery().orderBy("id").paginate(1000)).items.length).toBe(10);
      expect((await PlSmall.newQuery().orderBy("id").simplePaginate(1000)).pageItems().length).toBe(10);
      expect((await PlSmall.newQuery().orderBy("id").cursorPaginate(1000)).items.length).toBe(10);
      // above the application-wide 100, but under its own 500
      expect((await PlBig.newQuery().orderBy("id").paginate(1000)).items.length).toBe(ROWS);
      expect((await PlBig.newQuery().orderBy("id").cursorPaginate(1000)).items.length).toBe(ROWS);
    });

    test("an export can ask for everything on purpose", async () => {
      const all = await PlRow.newQuery().orderBy("id").paginate(1_000_000, 1, { unbounded: true });
      expect(all.items.length).toBe(ROWS);
      const simple = await PlRow.newQuery().orderBy("id").simplePaginate(1_000_000, 1, { unbounded: true });
      expect(simple.pageItems().length).toBe(ROWS);
    });

    test("a static call goes through the same limit", async () => {
      expect((await PlRow.orderBy("id").paginate(1_000_000)).items.length).toBe(100);
    });

    test("eager loading and filters still apply to the clamped page", async () => {
      const page = await PlRow.whereRaw("n > ?", [100]).orderBy("id").paginate(1_000_000);
      expect(page.total).toBe(150);
      expect(page.items.length).toBe(100);
    });
  });

  describe("the query builder", () => {
    const table = () => new QueryBuilder(c, "pl_rows").orderBy("id");

    test("paginate, simplePaginate and cursorPaginate are limited", async () => {
      expect((await table().paginate(1_000_000)).items.length).toBe(100);
      expect((await table().paginate(1_000_000, undefined, "page", 2)).items.length).toBe(100);
      expect((await table().simplePaginate(1_000_000)).pageItems().length).toBe(100);
      expect((await table().cursorPaginate(1_000_000)).items.length).toBe(100);
    });

    test("the legacy argument shape can opt out", async () => {
      expect((await table().paginate(1_000_000, 1, { unbounded: true })).items.length).toBe(ROWS);
      expect((await table().simplePaginate(1_000_000, 1, { unbounded: true })).pageItems().length).toBe(ROWS);
      expect((await table().cursorPaginate(1_000_000, null, { unbounded: true })).items.length).toBe(ROWS);
    });

    test("forPage is a plain offset and limit and is not clamped (it is what chunking uses)", async () => {
      expect((await table().forPage(1, 250).get()).all().length).toBe(ROWS);
    });
  });
});
