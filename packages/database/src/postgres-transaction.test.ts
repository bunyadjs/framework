import { expect, test } from "bun:test";
import {
  connectPostgres,
  DatabaseManager,
  schemaFor,
  type Connection,
} from "./index.ts";

async function tryPostgres(): Promise<Connection | null> {
  const url = Bun.env.BUNYAD_TEST_POSTGRES_URL ?? Bun.env.DATABASE_URL;
  const connection =
    url && /^(postgres|postgresql):\/\//i.test(url)
      ? connectPostgres({ url, max: 3 })
      : connectPostgres({
          hostname: Bun.env.DB_HOST ?? "127.0.0.1",
          port: Number(Bun.env.DB_PORT ?? 54329),
          database: Bun.env.DB_DATABASE ?? "bunyad",
          username: Bun.env.DB_USERNAME ?? "bunyad",
          password: Bun.env.DB_PASSWORD ?? "bunyad",
          max: 3,
        });
  try {
    await connection.exec("SELECT 1");
    return connection;
  } catch {
    try {
      await connection.close();
    } catch {
      /* ignore */
    }
    return null;
  }
}

test("Postgres pooled nested and concurrent transactions (skip if unavailable)", async () => {
  const connection = await tryPostgres();
  if (!connection) {
    return;
  }

  try {
    const schema = schemaFor(connection);
    await schema.dropIfExists("tx_accounts");
    await schema.create("tx_accounts", (table) => {
      table.id();
      table.integer("balance");
    });
    const db = new DatabaseManager(connection);
    await db.table("tx_accounts").insert({ balance: 100 });

    await connection.transaction(async () => {
      await db.table("tx_accounts").where("id", 1).update({ balance: 80 });
      await expect(
        connection.transaction(async () => {
          await db.table("tx_accounts").where("id", 1).update({ balance: 1 });
          throw new Error("inner-fail");
        }),
      ).rejects.toThrow("inner-fail");
      expect((await db.table("tx_accounts").first())?.balance).toBe(80);
    });
    expect((await db.table("tx_accounts").first())?.balance).toBe(80);

    await Promise.all([
      connection.transaction(async () => {
        await db.table("tx_accounts").insert({ balance: 2 });
      }),
      connection.transaction(async () => {
        await db.table("tx_accounts").insert({ balance: 3 });
      }),
    ]);
    expect(await db.table("tx_accounts").count()).toBe(3);

    await schema.dropIfExists("tx_accounts");
  } finally {
    await connection.close();
  }
});
