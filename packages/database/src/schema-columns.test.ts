import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "./index.ts";
import { testDriversForDatabase } from "./schema-columns.helper.ts";

const drivers = await testDriversForDatabase();

describe.each(drivers.map((d) => [d.name, d] as const))("Schema.getColumns (%s)", (_name, driver) => {
  const c = driver.connection;
  beforeAll(async () => {
    const schema = schemaFor(c);
    await schema.dropIfExists("gc_items");
    await schema.create("gc_items", (t) => {
      t.id();
      t.string("name");
      t.string("nick").nullable();
      t.integer("qty").default(3);
      t.boolean("active").nullable();
      t.text("notes").nullable();
      t.timestamps();
    });
  });
  afterAll(async () => { await schemaFor(c).dropIfExists("gc_items"); });

  test("describes names, nullability, defaults and the primary key", async () => {
    const cols = await schemaFor(c).getColumns("gc_items");
    const by = Object.fromEntries(cols.map((x) => [x.name, x]));
    expect(cols.map((x) => x.name)).toEqual(["id", "name", "nick", "qty", "active", "notes", "created_at", "updated_at"]);
    expect(by.id!.primary).toBe(true);
    expect(by.name!.primary).toBe(false);
    expect(by.name!.nullable).toBe(false);
    expect(by.nick!.nullable).toBe(true);
    expect(by.qty!.defaultValue).toContain("3");
    expect(by.name!.type.length).toBeGreaterThan(0);
  });

  test("rejects unsafe table names", async () => {
    await expect(schemaFor(c).getColumns("x; DROP TABLE y")).rejects.toThrow(/Invalid table name/);
  });
});
