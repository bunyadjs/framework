/**
 * Node ORM smoke: whereHas against live Postgres when available.
 * Skips cleanly otherwise (same gate as N6 / node-postgres-smoke).
 *
 * Run via packages/database `test:node` (includes this file).
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import {
  connectPostgres,
  schemaFor,
  type Connection,
} from "@bunyad/database";
import { Model } from "./index.ts";

function postgresUrlFromEnv(): string | null {
  const url =
    process.env.BUNYAD_TEST_POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.DB_URL;
  if (url && /^(postgres|postgresql):\/\//i.test(url)) return url;
  return null;
}

async function tryPostgres(): Promise<Connection | null> {
  const url = postgresUrlFromEnv();
  const connection = url
    ? connectPostgres({ url, max: 2 })
    : connectPostgres({
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 54329),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "bunyad",
        password: process.env.DB_PASSWORD ?? "bunyad",
        max: 2,
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

describe("Node ORM whereHas (skip unless Postgres reachable)", async () => {
  let connection: Connection | null = null;

  before(async () => {
    connection = await tryPostgres();
  });

  after(async () => {
    if (connection) await connection.close();
  });

  it("belongsTo whereHas filters by related column", async (t) => {
    if (!connection) {
      t.skip(
        "Postgres unavailable — set BUNYAD_TEST_POSTGRES_URL (or DATABASE_URL) to a reachable postgres:// URL",
      );
      return;
    }

    const schema = schemaFor(connection);
    for (const table of ["n6_orm_products", "n6_orm_brands"]) {
      await schema.dropIfExists(table);
    }
    await schema.create("n6_orm_brands", (table) => {
      table.id();
      table.string("name");
      table.timestamps();
    });
    await schema.create("n6_orm_products", (table) => {
      table.id();
      table.string("name");
      table.integer("brand_id").nullable();
      table.timestamps();
    });

    Model.setConnection(connection);

    class Brand extends Model {
      static table = "n6_orm_brands";
      static fillable = ["name"];
    }
    class Product extends Model {
      static table = "n6_orm_products";
      static fillable = ["name", "brand_id"];
      declare name: string;
      brand() {
        return this.belongsTo(Brand, "brand_id");
      }
    }

    const acme = await Brand.create({ name: "Acme" });
    const other = await Brand.create({ name: "Other" });
    await Product.create({ name: "A", brand_id: acme.id });
    await Product.create({ name: "B", brand_id: other.id });
    await Product.create({ name: "C", brand_id: acme.id });

    const viaHas = await Product.whereHas("brand", (q) => {
      q.where("name", "Other");
    }).get();
    assert.deepEqual(viaHas.pluck("name").all(), ["B"]);

    await schema.dropIfExists("n6_orm_products");
    await schema.dropIfExists("n6_orm_brands");
  });
});
