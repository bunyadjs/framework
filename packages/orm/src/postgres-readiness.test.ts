/**
 * Dual-driver readiness: same ORM queries on SQLite + Postgres.
 * Postgres skips when unavailable (set BUNYAD_TEST_POSTGRES_URL or DATABASE_URL).
 *
 * Date inputs use the zero-dep DateInput contract (string / Date / duck-typed toDate).
 */
import { expect, test } from "bun:test";
import {
  connectPostgres,
  connectSqlite,
  schemaFor,
  type Connection,
} from "@bunyad/database";
import { Model, OrmCollection } from "../src/index.ts";

async function tryPostgres(): Promise<Connection | null> {
  const url = Bun.env.BUNYAD_TEST_POSTGRES_URL ?? Bun.env.DATABASE_URL;
  const connection =
    url && /^(postgres|postgresql):\/\//i.test(url)
      ? connectPostgres({ url, max: 2 })
      : connectPostgres({
          hostname: Bun.env.DB_HOST ?? "127.0.0.1",
          port: Number(Bun.env.DB_PORT ?? 54329),
          database: Bun.env.DB_DATABASE ?? "bunyad",
          username: Bun.env.DB_USERNAME ?? "bunyad",
          password: Bun.env.DB_PASSWORD ?? "bunyad",
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

async function seedCatalog(connection: Connection) {
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  for (const table of [
    "product_tag",
    "products",
    "tags",
    "brands",
    "categories",
    "invoices",
    "notes",
  ]) {
    await schema.dropIfExists(table);
  }

  await schema.create("brands", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("categories", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("products", (table) => {
    table.id();
    table.string("name");
    table.integer("brand_id").nullable();
    table.integer("category_id").nullable();
    table.integer("price").default(0);
    table.timestamps();
  });
  await schema.create("tags", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });
  await schema.create("product_tag", (table) => {
    table.integer("product_id");
    table.integer("tag_id");
  });
  await schema.create("invoices", (table) => {
    table.id();
    table.string("ref");
    table.date("due_on");
    table.dateTime("published_at").nullable();
    table.timestamps();
  });
  await schema.create("notes", (table) => {
    table.id();
    table.string("body");
    table.text("deleted_at").nullable();
    table.timestamps();
  });

  class Brand extends Model {
    static table = "brands";
    static fillable = ["name"];
    declare name: string;
    products() {
      return this.hasMany(Product, "brand_id");
    }
  }
  class Category extends Model {
    static table = "categories";
    static fillable = ["name"];
  }
  class Tag extends Model {
    static table = "tags";
    static fillable = ["name"];
    declare name: string;
  }
  class Product extends Model {
    static table = "products";
    static fillable = ["name", "brand_id", "category_id", "price"];
    declare name: string;
    brand() {
      return this.belongsTo(Brand, "brand_id");
    }
    category() {
      return this.belongsTo(Category, "category_id");
    }
    tags() {
      return this.belongsToMany(Tag, "product_tag", "product_id", "tag_id");
    }
  }
  class Invoice extends Model {
    static table = "invoices";
    static fillable = ["ref", "due_on", "published_at"];
    static casts = {
      due_on: "date" as const,
      published_at: "datetime" as const,
    };
    declare ref: string;
    declare due_on: Date;
    declare published_at: Date | null;
  }
  class Note extends Model {
    static table = "notes";
    static fillable = ["body"];
    static softDeletes = true;
    declare body: string;
  }

  return { Brand, Category, Tag, Product, Invoice, Note };
}

/** Same assertions for every driver — query API must not diverge. */
async function assertSameQueryMatrix(connection: Connection): Promise<void> {
  const { Brand, Product, Tag, Invoice, Note } = await seedCatalog(connection);

  const acme = await Brand.create({ name: "Acme" });
  const other = await Brand.create({ name: "Other" });
  await Product.create({ name: "A", brand_id: acme.id, price: 1 });
  await Product.create({ name: "B", brand_id: other.id, price: 2 });
  await Product.create({ name: "C", brand_id: acme.id, price: 3 });

  const byName = await Product.whereRelation("brand", "name", "Acme").get();
  expect(byName).toBeInstanceOf(OrmCollection);
  expect(byName.pluck("name").sort().all()).toEqual(["A", "C"]);

  const viaHas = await Product.whereHas("brand", (q) => {
    q.where("name", "Other");
  }).get();
  expect(viaHas.pluck("name").all()).toEqual(["B"]);

  const counted = await Brand.withCount("products").orderBy("name").get();
  expect(
    Number((counted.first() as unknown as Record<string, unknown>).products_count),
  ).toBe(2);

  const joined = await Product.join(
    "brands",
    "products.brand_id",
    "=",
    "brands.id",
  )
    .where("brands.name", "Acme")
    .orderBy("products.name")
    .get();
  expect(joined).toBeInstanceOf(OrmCollection);
  expect(joined.pluck("name").all()).toEqual(["A", "C"]);

  const p = await Product.create({ name: "Tagged", price: 1 });
  const t = await Tag.create({ name: "sale" });
  await p.tags().attach([t.id!]);
  expect(
    (await Product.whereRelation("tags", "name", "sale").get()).count(),
  ).toBe(1);

  // Dates: same whereDate for YMD string, Date, and duck-typed toDate (dayjs-shaped).
  await Invoice.create({
    ref: "inv-1",
    due_on: "2026-08-08",
    published_at: "2026-08-08 14:30:00",
  });
  await Invoice.create({
    ref: "inv-2",
    due_on: "2026-08-09",
    published_at: "2026-08-09 10:00:00",
  });

  const byYmd = await Invoice.whereDate("due_on", "2026-08-08").get();
  expect(byYmd.pluck("ref").all()).toEqual(["inv-1"]);

  const byDate = await Invoice.whereDate(
    "due_on",
    new Date("2026-08-08T00:00:00.000Z"),
  ).get();
  expect(byDate.pluck("ref").all()).toEqual(["inv-1"]);

  const duck = {
    toDate: () => new Date("2026-08-08T12:00:00.000Z"),
  };
  const byDuck = await Invoice.whereDate("due_on", duck).get();
  expect(byDuck.pluck("ref").all()).toEqual(["inv-1"]);

  const byOp = await Invoice.whereDate("due_on", ">=", "2026-08-09").get();
  expect(byOp.pluck("ref").all()).toEqual(["inv-2"]);

  const casted = await Invoice.where("ref", "inv-1").first();
  expect(casted!.due_on).toBeInstanceOf(Date);
  expect(casted!.due_on.toISOString().slice(0, 10)).toBe("2026-08-08");
  expect(casted!.published_at).toBeInstanceOf(Date);

  // paginate / firstOrCreate / soft deletes — same call sites per driver
  const page = await Product.orderBy("name").paginate(2, 1);
  expect(page.items).toHaveLength(2);
  expect(page.total).toBe(4);

  const created = await Brand.firstOrCreate({ name: "Acme" }, {});
  expect(created.name).toBe("Acme");
  expect(await Brand.where("name", "Acme").count()).toBe(1);

  const note = await Note.create({ body: "keep" });
  await note.delete();
  expect((await Note.all()).count()).toBe(0);
  expect(await Note.withTrashed().count()).toBe(1);
  await note.restore();
  expect((await Note.all()).count()).toBe(1);

  // Nested whereNot
  const notOther = await Product.whereNot((q) => {
    q.where("name", "B");
  })
    .orderBy("name")
    .get();
  expect(notOther.pluck("name").all()).toEqual(["A", "C", "Tagged"]);

  // Transaction rollback
  try {
    await connection.transaction(async () => {
      await Brand.create({ name: "TxRollback" });
      throw new Error("rollback");
    });
  } catch (e) {
    expect((e as Error).message).toBe("rollback");
  }
  expect(await Brand.where("name", "TxRollback").count()).toBe(0);

  // SQLite sync API (skip semantics on Postgres — throws)
  if (connection.driver === "sqlite") {
    const syncAll = Product.orderBy("name").getSync();
    expect(syncAll).toBeInstanceOf(OrmCollection);
    expect(syncAll.count()).toBe(4);
    const syncOne = Product.where("name", "A").firstSync();
    expect(syncOne?.name).toBe("A");
    expect(Product.findSync(syncOne!.id!)?.name).toBe("A");
    expect(Brand.allSync().count()).toBeGreaterThanOrEqual(2);
  } else {
    expect(() => Product.newQuery().getSync()).toThrow(/SQLite/);
  }
}

test("SQLite: same query matrix (relations + dates)", async () => {
  const connection = connectSqlite();
  try {
    await assertSameQueryMatrix(connection);
  } finally {
    await connection.close();
  }
});

test("Postgres: same query matrix (skip if unavailable)", async () => {
  const connection = await tryPostgres();
  if (!connection) {
    console.warn(
      "[postgres-readiness] Postgres unavailable — skip. Set BUNYAD_TEST_POSTGRES_URL to run.",
    );
    return;
  }
  try {
    await assertSameQueryMatrix(connection);
  } finally {
    await connection.close();
  }
});
