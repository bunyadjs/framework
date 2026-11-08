/**
 * Decimal, float and double columns hold numbers on every database, so comparisons, ordering and
 * aggregates work by value (on SQLite they must not fall back to comparing text).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "./index.ts";
import { testDriversForDatabase } from "./schema-columns.helper.ts";

const drivers = await testDriversForDatabase();
const VALUES = [9, 10, 100, -5, 2.5, 0, 1000];

describe.each(drivers.map((d) => [d.name, d] as const))(
  "numeric columns (%s)",
  (_name, driver) => {
    const c = driver.connection;

    beforeAll(async () => {
      const schema = schemaFor(c);
      await schema.dropIfExists("nc_rows");
      await schema.create("nc_rows", (t) => {
        t.id();
        t.decimal("amt", 15, 2).default(0);
        t.float("f").default(0);
        t.double("d").default(0);
        t.integer("qty").default(0);
      });
      for (const v of VALUES) {
        await c.run(
          "INSERT INTO nc_rows (amt, f, d, qty) VALUES (?, ?, ?, ?)",
          [v, v, v, Math.round(v)],
        );
      }
    });

    afterAll(async () => {
      await schemaFor(c).dropIfExists("nc_rows");
    });

    const column = async (sql: string, params: unknown[] = []) =>
      (await c.all<{ v: unknown }>(sql, params)).map((row) => Number(row.v));

    for (const col of ["amt", "f", "d"]) {
      test(`${col}: comparisons use the number, not the text`, async () => {
        expect(
          await column(
            `SELECT ${col} AS v FROM nc_rows WHERE ${col} > ? ORDER BY id`,
            [9],
          ),
        ).toEqual([10, 100, 1000]);
        expect(
          await column(
            `SELECT ${col} AS v FROM nc_rows WHERE ${col} BETWEEN ? AND ? ORDER BY id`,
            [5, 50],
          ),
        ).toEqual([9, 10]);
        expect(
          await column(
            `SELECT ${col} AS v FROM nc_rows WHERE ${col} >= ? ORDER BY id`,
            [0],
          ),
        ).toEqual([9, 10, 100, 2.5, 0, 1000]);
      });

      test(`${col}: ordering and MAX / MIN go by value`, async () => {
        expect(
          await column(`SELECT ${col} AS v FROM nc_rows ORDER BY ${col}`),
        ).toEqual([-5, 0, 2.5, 9, 10, 100, 1000]);
        expect(await column(`SELECT MAX(${col}) AS v FROM nc_rows`)).toEqual([
          1000,
        ]);
        expect(await column(`SELECT MIN(${col}) AS v FROM nc_rows`)).toEqual([
          -5,
        ]);
        expect(await column(`SELECT SUM(${col}) AS v FROM nc_rows`)).toEqual([
          1116.5,
        ]);
      });
    }

    test("a decimal column compares with another numeric column", async () => {
      // 10 against 9: larger as numbers, smaller as text
      await c.run(
        "INSERT INTO nc_rows (amt, f, d, qty) VALUES (?, ?, ?, ?)",
        [10, 10, 10, 9],
      );
      expect(
        await column(
          "SELECT amt AS v FROM nc_rows WHERE amt > qty ORDER BY id",
        ),
      ).toEqual([10]);
      await c.run("DELETE FROM nc_rows WHERE qty = 9");
    });

    test("a value written as text with two decimals still compares as a number", async () => {
      await c.run("INSERT INTO nc_rows (amt, f, d, qty) VALUES (?, ?, ?, ?)", [
        "7.50",
        7.5,
        7.5,
        8,
      ]);
      expect(
        await column(
          "SELECT amt AS v FROM nc_rows WHERE amt > ? AND amt < ? ORDER BY id",
          [7, 9],
        ),
      ).toEqual([7.5]);
      await c.run("DELETE FROM nc_rows WHERE qty = 8");
    });
  },
);
