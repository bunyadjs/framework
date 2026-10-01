/**
 * Plain Node smoke: CRUD + transaction + ORM whereHas via @bunyad/database Node entry.
 * Skips when Postgres is unavailable.
 *
 *   node --experimental-transform-types packages/database/scripts/node-postgres-smoke.mjs
 *   bun run --cwd packages/database smoke:node
 */
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const indexNode = join(here, "../src/index.node.ts");
const ormIndex = join(here, "../../orm/src/index.ts");

const {
  connectPostgres,
  schemaFor,
  DatabaseManager,
} = await import(pathToFileURL(indexNode).href);
const { Model } = await import(pathToFileURL(ormIndex).href);

const url =
  process.env.BUNYAD_TEST_POSTGRES_URL ??
  process.env.DATABASE_URL ??
  process.env.DB_URL;

const connection = url && /^(postgres|postgresql):\/\//i.test(url)
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
} catch (error) {
  console.log(
    "SKIP node-postgres-smoke: Postgres unavailable —",
    error instanceof Error ? error.message : error,
  );
  try {
    await connection.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

try {
  const schema = schemaFor(connection);
  await schema.dropIfExists("smoke_users");
  await schema.create("smoke_users", (table) => {
    table.id();
    table.string("email");
  });
  const db = new DatabaseManager(connection);
  const id = await db.table("smoke_users").insertGetId({ email: "a@b.c" });
  await connection.transaction(async () => {
    await db.table("smoke_users").where("id", id).update({ email: "x@y.z" });
  });
  const row = await db.table("smoke_users").where("id", id).first();
  if (row?.email !== "x@y.z") {
    throw new Error(`unexpected row: ${JSON.stringify(row)}`);
  }
  await schema.dropIfExists("smoke_users");
  console.log("OK node-postgres-smoke: CRUD + transaction");

  // ORM-level whereHas (belongsTo) — one relation assert
  for (const table of ["smoke_products", "smoke_brands"]) {
    await schema.dropIfExists(table);
  }
  await schema.create("smoke_brands", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("smoke_products", (table) => {
    table.id();
    table.string("name");
    table.integer("brand_id").nullable();
    table.timestamps();
  });

  Model.setConnection(connection);

  class SmokeBrand extends Model {
    static table = "smoke_brands";
    static fillable = ["name"];
  }
  class SmokeProduct extends Model {
    static table = "smoke_products";
    static fillable = ["name", "brand_id"];
    brand() {
      return this.belongsTo(SmokeBrand, "brand_id");
    }
  }

  const acme = await SmokeBrand.create({ name: "Acme" });
  const other = await SmokeBrand.create({ name: "Other" });
  await SmokeProduct.create({ name: "A", brand_id: acme.id });
  await SmokeProduct.create({ name: "B", brand_id: other.id });
  await SmokeProduct.create({ name: "C", brand_id: acme.id });

  const viaHas = await SmokeProduct.whereHas("brand", (q) => {
    q.where("name", "Other");
  }).get();
  const names = viaHas.pluck("name").all();
  if (names.length !== 1 || names[0] !== "B") {
    throw new Error(`whereHas expected ["B"], got ${JSON.stringify(names)}`);
  }

  await schema.dropIfExists("smoke_products");
  await schema.dropIfExists("smoke_brands");
  console.log("OK node-postgres-smoke: ORM whereHas (belongsTo)");
} finally {
  await connection.close();
}
