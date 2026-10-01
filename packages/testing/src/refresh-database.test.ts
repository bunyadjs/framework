import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectSqlite } from "@bunyad/database";
import { refreshDatabase } from "../src/refresh-database.ts";

test("refreshDatabase runs migrations on empty database", async () => {
  const connection = connectSqlite();
  const dir = await mkdtemp(join(tmpdir(), "bunyad-refresh-"));
  await Bun.write(
    join(dir, "2026_01_01_000000_create_items.ts"),
    `export async function up(schema) {
      await schema.create("items", (table) => {
        table.id();
        table.string("name");
      });
    }`,
  );

  await refreshDatabase({ connection, migrationsPath: dir });
  expect(
    await connection.get(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'",
    ),
  ).toBeTruthy();

  await connection.run("INSERT INTO items (name) VALUES (?)", ["Ada"]);
  expect(
    (await connection.get("SELECT COUNT(*) as c FROM items"))?.c,
  ).toBe(1);

  await refreshDatabase({ connection, migrationsPath: dir });
  expect(
    (await connection.get("SELECT COUNT(*) as c FROM items"))?.c,
  ).toBe(0);

  await connection.close();
});

test("refreshDatabase runs seed callback", async () => {
  const connection = connectSqlite();
  const dir = await mkdtemp(join(tmpdir(), "bunyad-refresh-seed-"));
  await Bun.write(
    join(dir, "2026_01_01_000000_create_items.ts"),
    `export async function up(schema) {
      await schema.create("items", (table) => {
        table.id();
        table.string("name");
      });
    }`,
  );

  let seeded = false;
  await refreshDatabase({
    connection,
    migrationsPath: dir,
    seed: async () => {
      seeded = true;
      await connection.run("INSERT INTO items (name) VALUES (?)", ["seed"]);
    },
  });

  expect(seeded).toBe(true);
  expect(
    (await connection.get("SELECT name FROM items WHERE id = 1"))?.name,
  ).toBe("seed");
  await connection.close();
});
