#!/usr/bin/env bun
/**
 * ORM compare (PLAN.md §4) — identical SQLite workloads:
 *   Bunyad ORM, Prisma, Drizzle (+ optional pure SQL baseline)
 *
 * Legs: find-by-id, where-limit, insert, update, belongs-to-eager, paginate
 *
 * Usage:
 *   bun benchmarks/orm/compare.ts
 *   SEED=1000 ITERATIONS=500 PAGE=50 WARMUP=50 bun benchmarks/orm/compare.ts
 *   ORMS=bunyad,prisma,drizzle,sql bun benchmarks/orm/compare.ts
 *
 * Fairness: same seed size, page size, and query intent per leg.
 * Do not invent numbers — write only measured metrics.
 */
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { eq, sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { PrismaClient } from "@prisma/client";
import { connectSqlite, schemaFor } from "../../packages/database/src/index.ts";
import { Model } from "../../packages/orm/src/index.ts";
import { ORM_COMPARE } from "../config/default.ts";
import { collectFingerprint } from "../lib/fingerprint.ts";
import {
  emptyMetrics,
  type BenchmarkResult,
} from "../lib/result-schema.ts";
import { measureIterations } from "../lib/timing.ts";
import { writeSuiteResults } from "../lib/write-result.ts";
import * as drizzleSchema from "./drizzle-schema.ts";

const BENCHMARK = "orm-compare";
const SEED = Number(process.env.SEED ?? ORM_COMPARE.seed);
const ITERATIONS = Number(process.env.ITERATIONS ?? ORM_COMPARE.iterations);
const PAGE = Number(process.env.PAGE ?? ORM_COMPARE.page);
const WARMUP = Number(process.env.WARMUP ?? ORM_COMPARE.warmup);

const TMP = join(import.meta.dir, ".tmp");
const BRAND_COUNT = 10;

type OrmId = "bunyad" | "prisma" | "drizzle" | "sql";

const LEGS = [
  "find-by-id",
  "where-limit",
  "insert",
  "update",
  "belongs-to-eager",
  "paginate",
] as const;
type Leg = (typeof LEGS)[number];

function parseOrmFilter(): Set<OrmId> | null {
  const raw = process.env.ORMS?.trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean) as OrmId[],
  );
}

function pkgVersion(name: string, fromDir: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(fromDir, "node_modules", name, "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function fmtOps(n: number): string {
  return Math.round(n).toLocaleString().padStart(12);
}

async function timedLeg(
  warmup: () => void | Promise<void>,
  body: () => void | Promise<void>,
): Promise<{ wallMs: number; opsPerSecond: number }> {
  for (let i = 0; i < WARMUP; i++) {
    await warmup();
  }
  return measureIterations(ITERATIONS, body, 0);
}

function baseRow(
  framework: string,
  frameworkVersion: string | null,
  dependencies: Record<string, string>,
  scenario: string,
  startedAt: string,
  finishedAt: string,
  measured: { wallMs: number; opsPerSecond: number },
): BenchmarkResult {
  const fp = collectFingerprint();
  return {
    benchmark: BENCHMARK,
    scenario,
    framework,
    frameworkVersion,
    dependencies,
    runtime: fp.runtime,
    environment: {
      cpu: fp.environment.cpu,
      cpuCores: fp.environment.cpuCores,
      memoryGb: fp.environment.memoryGb,
      os: fp.environment.os,
      arch: fp.environment.arch,
    },
    workload: {
      durationMs: measured.wallMs,
      warmupMs: 0,
      concurrency: 1,
      iterations: ITERATIONS,
    },
    results: emptyMetrics({
      opsPerSecond: measured.opsPerSecond,
      wallMs: measured.wallMs,
      errors: 0,
    }),
    startedAt,
    finishedAt,
    methodology:
      "Identical SQLite schema+seed; fixed-iteration legs after warmup; fair query intent across ORMs (PLAN.md §4/§6).",
  };
}

// ---------- Bunyad ----------

async function runBunyad(deps: Record<string, string>): Promise<BenchmarkResult[]> {
  const dbPath = join(TMP, "bunyad.sqlite");
  rmSync(dbPath, { force: true });
  const connection = connectSqlite({ path: dbPath });
  Model.setConnection(connection);
  const schema = schemaFor(connection);

  await schema.create("brands", (t) => {
    t.id();
    t.string("name");
  });
  await schema.create("products", (t) => {
    t.id();
    t.string("name");
    t.integer("brand_id");
    t.integer("price");
  });

  class Brand extends Model {
    static table = "brands";
    static timestamps = false;
    static fillable = ["name"];
    products() {
      return this.hasMany(Product, "brand_id");
    }
  }
  class Product extends Model {
    static table = "products";
    static timestamps = false;
    static fillable = ["name", "brand_id", "price"];
    brand() {
      return this.belongsTo(Brand, "brand_id");
    }
  }

  for (let i = 1; i <= BRAND_COUNT; i++) {
    await Brand.create({ name: `Brand-${i}` });
  }
  for (let i = 1; i <= SEED; i++) {
    await Product.create({
      name: `Product-${i}`,
      brand_id: ((i - 1) % BRAND_COUNT) + 1,
      price: i,
    });
  }

  const midId = Math.floor(SEED / 2) || 1;
  const rows: BenchmarkResult[] = [];

  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await Product.find(midId);
      },
      async () => {
        await Product.find(midId);
      },
    );
    rows.push(
      baseRow("bunyad-orm", "0.0.0", deps, "find-by-id", startedAt, new Date().toISOString(), m),
    );
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await Product.where("brand_id", 1).orderBy("id").limit(PAGE).get();
      },
      async () => {
        await Product.where("brand_id", 1).orderBy("id").limit(PAGE).get();
      },
    );
    rows.push(
      baseRow("bunyad-orm", "0.0.0", deps, "where-limit", startedAt, new Date().toISOString(), m),
    );
  }
  {
    let n = SEED + 1;
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await Product.create({
          name: `W-${n}`,
          brand_id: 1,
          price: n,
        });
        n += 1;
      },
      async () => {
        await Product.create({
          name: `I-${n}`,
          brand_id: 1,
          price: n,
        });
        n += 1;
      },
    );
    rows.push(
      baseRow("bunyad-orm", "0.0.0", deps, "insert", startedAt, new Date().toISOString(), m),
    );
  }
  {
    const startedAt = new Date().toISOString();
    let tick = 0;
    const m = await timedLeg(
      async () => {
        const p = await Product.find(midId);
        await p!.update({ price: midId + tick });
        tick += 1;
      },
      async () => {
        const p = await Product.find(midId);
        await p!.update({ price: midId + tick });
        tick += 1;
      },
    );
    rows.push(
      baseRow("bunyad-orm", "0.0.0", deps, "update", startedAt, new Date().toISOString(), m),
    );
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await Product.with("brand").where("brand_id", 1).orderBy("id").limit(PAGE).get();
      },
      async () => {
        await Product.with("brand").where("brand_id", 1).orderBy("id").limit(PAGE).get();
      },
    );
    rows.push(
      baseRow(
        "bunyad-orm",
        "0.0.0",
        deps,
        "belongs-to-eager",
        startedAt,
        new Date().toISOString(),
        m,
      ),
    );
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await Product.orderBy("id").paginate(PAGE, 1);
      },
      async () => {
        await Product.orderBy("id").paginate(PAGE, 1);
      },
    );
    rows.push(
      baseRow("bunyad-orm", "0.0.0", deps, "paginate", startedAt, new Date().toISOString(), m),
    );
  }

  await connection.close();
  return rows;
}

// ---------- Prisma ----------

async function ensurePrismaSchema(dbUrl: string): Promise<void> {
  process.env.ORM_BENCH_PRISMA_URL = dbUrl;
  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand_id INTEGER NOT NULL,
      price INTEGER NOT NULL
    );
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS products_brand_id_idx ON products(brand_id);`,
  );
  await prisma.$disconnect();
}

async function runPrisma(deps: Record<string, string>): Promise<BenchmarkResult[]> {
  const dbPath = join(TMP, "prisma.sqlite");
  rmSync(dbPath, { force: true });
  const dbUrl = `file:${dbPath}`;
  process.env.ORM_BENCH_PRISMA_URL = dbUrl;
  await ensurePrismaSchema(dbUrl);

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  for (let i = 1; i <= BRAND_COUNT; i++) {
    await prisma.brand.create({ data: { name: `Brand-${i}` } });
  }
  // Batch create for seed speed (not timed)
  const productRows = Array.from({ length: SEED }, (_, i) => ({
    name: `Product-${i + 1}`,
    brandId: (i % BRAND_COUNT) + 1,
    price: i + 1,
  }));
  // createMany if available
  if (typeof prisma.product.createMany === "function") {
    await prisma.product.createMany({ data: productRows });
  } else {
    for (const row of productRows) {
      await prisma.product.create({ data: row });
    }
  }

  const midId = Math.floor(SEED / 2) || 1;
  const version = deps["@prisma/client"] ?? "unknown";
  const rows: BenchmarkResult[] = [];

  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await prisma.product.findUnique({ where: { id: midId } });
      },
      async () => {
        await prisma.product.findUnique({ where: { id: midId } });
      },
    );
    rows.push(baseRow("prisma", version, deps, "find-by-id", startedAt, new Date().toISOString(), m));
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await prisma.product.findMany({
          where: { brandId: 1 },
          orderBy: { id: "asc" },
          take: PAGE,
        });
      },
      async () => {
        await prisma.product.findMany({
          where: { brandId: 1 },
          orderBy: { id: "asc" },
          take: PAGE,
        });
      },
    );
    rows.push(baseRow("prisma", version, deps, "where-limit", startedAt, new Date().toISOString(), m));
  }
  {
    let n = SEED + 1;
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await prisma.product.create({
          data: { name: `W-${n}`, brandId: 1, price: n },
        });
        n += 1;
      },
      async () => {
        await prisma.product.create({
          data: { name: `I-${n}`, brandId: 1, price: n },
        });
        n += 1;
      },
    );
    rows.push(baseRow("prisma", version, deps, "insert", startedAt, new Date().toISOString(), m));
  }
  {
    let tick = 0;
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await prisma.product.update({
          where: { id: midId },
          data: { price: midId + tick },
        });
        tick += 1;
      },
      async () => {
        await prisma.product.update({
          where: { id: midId },
          data: { price: midId + tick },
        });
        tick += 1;
      },
    );
    rows.push(baseRow("prisma", version, deps, "update", startedAt, new Date().toISOString(), m));
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await prisma.product.findMany({
          where: { brandId: 1 },
          orderBy: { id: "asc" },
          take: PAGE,
          include: { brand: true },
        });
      },
      async () => {
        await prisma.product.findMany({
          where: { brandId: 1 },
          orderBy: { id: "asc" },
          take: PAGE,
          include: { brand: true },
        });
      },
    );
    rows.push(
      baseRow("prisma", version, deps, "belongs-to-eager", startedAt, new Date().toISOString(), m),
    );
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await prisma.product.findMany({
          orderBy: { id: "asc" },
          skip: 0,
          take: PAGE,
        });
        await prisma.product.count();
      },
      async () => {
        await prisma.product.findMany({
          orderBy: { id: "asc" },
          skip: 0,
          take: PAGE,
        });
        await prisma.product.count();
      },
    );
    rows.push(baseRow("prisma", version, deps, "paginate", startedAt, new Date().toISOString(), m));
  }

  await prisma.$disconnect();
  return rows;
}

// ---------- Drizzle ----------

async function runDrizzle(deps: Record<string, string>): Promise<BenchmarkResult[]> {
  const dbPath = join(TMP, "drizzle.sqlite");
  rmSync(dbPath, { force: true });
  const sqlite = new Database(dbPath, { create: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run(`
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
  `);
  sqlite.run(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand_id INTEGER NOT NULL,
      price INTEGER NOT NULL
    );
  `);
  sqlite.run(`CREATE INDEX products_brand_id_idx ON products(brand_id);`);

  const db = drizzle(sqlite, { schema: drizzleSchema });
  const { brands, products } = drizzleSchema;

  for (let i = 1; i <= BRAND_COUNT; i++) {
    await db.insert(brands).values({ name: `Brand-${i}` });
  }
  for (let i = 1; i <= SEED; i++) {
    await db.insert(products).values({
      name: `Product-${i}`,
      brandId: ((i - 1) % BRAND_COUNT) + 1,
      price: i,
    });
  }

  const midId = Math.floor(SEED / 2) || 1;
  const version = deps["drizzle-orm"] ?? "unknown";
  const rows: BenchmarkResult[] = [];

  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await db.select().from(products).where(eq(products.id, midId)).limit(1);
      },
      async () => {
        await db.select().from(products).where(eq(products.id, midId)).limit(1);
      },
    );
    rows.push(baseRow("drizzle", version, deps, "find-by-id", startedAt, new Date().toISOString(), m));
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await db
          .select()
          .from(products)
          .where(eq(products.brandId, 1))
          .orderBy(products.id)
          .limit(PAGE);
      },
      async () => {
        await db
          .select()
          .from(products)
          .where(eq(products.brandId, 1))
          .orderBy(products.id)
          .limit(PAGE);
      },
    );
    rows.push(baseRow("drizzle", version, deps, "where-limit", startedAt, new Date().toISOString(), m));
  }
  {
    let n = SEED + 1;
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await db.insert(products).values({ name: `W-${n}`, brandId: 1, price: n });
        n += 1;
      },
      async () => {
        await db.insert(products).values({ name: `I-${n}`, brandId: 1, price: n });
        n += 1;
      },
    );
    rows.push(baseRow("drizzle", version, deps, "insert", startedAt, new Date().toISOString(), m));
  }
  {
    let tick = 0;
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await db
          .update(products)
          .set({ price: midId + tick })
          .where(eq(products.id, midId));
        tick += 1;
      },
      async () => {
        await db
          .update(products)
          .set({ price: midId + tick })
          .where(eq(products.id, midId));
        tick += 1;
      },
    );
    rows.push(baseRow("drizzle", version, deps, "update", startedAt, new Date().toISOString(), m));
  }
  {
    const startedAt = new Date().toISOString();
    // Eager equivalent: join brands (same intent as include/with — one round-trip list+parent)
    const m = await timedLeg(
      async () => {
        await db
          .select({
            id: products.id,
            name: products.name,
            brandId: products.brandId,
            price: products.price,
            brandName: brands.name,
          })
          .from(products)
          .innerJoin(brands, eq(products.brandId, brands.id))
          .where(eq(products.brandId, 1))
          .orderBy(products.id)
          .limit(PAGE);
      },
      async () => {
        await db
          .select({
            id: products.id,
            name: products.name,
            brandId: products.brandId,
            price: products.price,
            brandName: brands.name,
          })
          .from(products)
          .innerJoin(brands, eq(products.brandId, brands.id))
          .where(eq(products.brandId, 1))
          .orderBy(products.id)
          .limit(PAGE);
      },
    );
    rows.push(
      baseRow("drizzle", version, deps, "belongs-to-eager", startedAt, new Date().toISOString(), m),
    );
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await db.select().from(products).orderBy(products.id).limit(PAGE).offset(0);
        await db.select({ c: dsql<number>`count(*)` }).from(products);
      },
      async () => {
        await db.select().from(products).orderBy(products.id).limit(PAGE).offset(0);
        await db.select({ c: dsql<number>`count(*)` }).from(products);
      },
    );
    rows.push(baseRow("drizzle", version, deps, "paginate", startedAt, new Date().toISOString(), m));
  }

  sqlite.close();
  return rows;
}

// ---------- Pure SQL baseline (optional) ----------

async function runSql(deps: Record<string, string>): Promise<BenchmarkResult[]> {
  const dbPath = join(TMP, "sql.sqlite");
  rmSync(dbPath, { force: true });
  const connection = connectSqlite({ path: dbPath });
  await connection.run(`
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );
  `);
  await connection.run(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand_id INTEGER NOT NULL,
      price INTEGER NOT NULL
    );
  `);
  await connection.run(
    `CREATE INDEX products_brand_id_idx ON products(brand_id);`,
  );

  for (let i = 1; i <= BRAND_COUNT; i++) {
    await connection.run(`INSERT INTO brands (name) VALUES (?)`, [`Brand-${i}`]);
  }
  for (let i = 1; i <= SEED; i++) {
    await connection.run(
      `INSERT INTO products (name, brand_id, price) VALUES (?, ?, ?)`,
      [`Product-${i}`, ((i - 1) % BRAND_COUNT) + 1, i],
    );
  }

  const midId = Math.floor(SEED / 2) || 1;
  const rows: BenchmarkResult[] = [];

  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await connection.get(`SELECT * FROM products WHERE id = ?`, [midId]);
      },
      async () => {
        await connection.get(`SELECT * FROM products WHERE id = ?`, [midId]);
      },
    );
    rows.push(baseRow("pure-sql", "bunyad-connection", deps, "find-by-id", startedAt, new Date().toISOString(), m));
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await connection.all(
          `SELECT * FROM products WHERE brand_id = ? ORDER BY id LIMIT ?`,
          [1, PAGE],
        );
      },
      async () => {
        await connection.all(
          `SELECT * FROM products WHERE brand_id = ? ORDER BY id LIMIT ?`,
          [1, PAGE],
        );
      },
    );
    rows.push(baseRow("pure-sql", "bunyad-connection", deps, "where-limit", startedAt, new Date().toISOString(), m));
  }
  {
    let n = SEED + 1;
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await connection.run(
          `INSERT INTO products (name, brand_id, price) VALUES (?, ?, ?)`,
          [`W-${n}`, 1, n],
        );
        n += 1;
      },
      async () => {
        await connection.run(
          `INSERT INTO products (name, brand_id, price) VALUES (?, ?, ?)`,
          [`I-${n}`, 1, n],
        );
        n += 1;
      },
    );
    rows.push(baseRow("pure-sql", "bunyad-connection", deps, "insert", startedAt, new Date().toISOString(), m));
  }
  {
    let tick = 0;
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await connection.run(`UPDATE products SET price = ? WHERE id = ?`, [
          midId + tick,
          midId,
        ]);
        tick += 1;
      },
      async () => {
        await connection.run(`UPDATE products SET price = ? WHERE id = ?`, [
          midId + tick,
          midId,
        ]);
        tick += 1;
      },
    );
    rows.push(baseRow("pure-sql", "bunyad-connection", deps, "update", startedAt, new Date().toISOString(), m));
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await connection.all(
          `SELECT products.*, brands.name AS brand_name
           FROM products INNER JOIN brands ON brands.id = products.brand_id
           WHERE products.brand_id = ? ORDER BY products.id LIMIT ?`,
          [1, PAGE],
        );
      },
      async () => {
        await connection.all(
          `SELECT products.*, brands.name AS brand_name
           FROM products INNER JOIN brands ON brands.id = products.brand_id
           WHERE products.brand_id = ? ORDER BY products.id LIMIT ?`,
          [1, PAGE],
        );
      },
    );
    rows.push(
      baseRow("pure-sql", "bunyad-connection", deps, "belongs-to-eager", startedAt, new Date().toISOString(), m),
    );
  }
  {
    const startedAt = new Date().toISOString();
    const m = await timedLeg(
      async () => {
        await connection.all(
          `SELECT * FROM products ORDER BY id LIMIT ? OFFSET 0`,
          [PAGE],
        );
        await connection.get(`SELECT COUNT(*) AS c FROM products`);
      },
      async () => {
        await connection.all(
          `SELECT * FROM products ORDER BY id LIMIT ? OFFSET 0`,
          [PAGE],
        );
        await connection.get(`SELECT COUNT(*) AS c FROM products`);
      },
    );
    rows.push(baseRow("pure-sql", "bunyad-connection", deps, "paginate", startedAt, new Date().toISOString(), m));
  }

  await connection.close();
  return rows;
}

async function main(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  const filter = parseOrmFilter();
  const ormDir = import.meta.dir;
  const deps = {
    "@prisma/client": pkgVersion("@prisma/client", ormDir),
    prisma: pkgVersion("prisma", ormDir),
    "drizzle-orm": pkgVersion("drizzle-orm", ormDir),
    bunyad: "0.0.0",
  };

  const fp = collectFingerprint();
  console.log("ORM compare (slim PLAN)\n");
  console.log(
    `machine: ${fp.environment.cpu} ×${fp.environment.cpuCores} | RAM ${fp.environment.memoryGb} GB | ${fp.environment.os}/${fp.environment.arch} | Bun ${fp.runtime.version}`,
  );
  console.log(
    `SEED=${SEED} ITERATIONS=${ITERATIONS} PAGE=${PAGE} WARMUP=${WARMUP}`,
  );
  console.log(`legs: ${LEGS.join(", ")}\n`);

  const all: BenchmarkResult[] = [];
  const runners: Array<{ id: OrmId; run: () => Promise<BenchmarkResult[]> }> = [
    { id: "bunyad", run: () => runBunyad(deps) },
    { id: "prisma", run: () => runPrisma(deps) },
    { id: "drizzle", run: () => runDrizzle(deps) },
    { id: "sql", run: () => runSql(deps) },
  ];

  for (const { id, run } of runners) {
    if (filter && !filter.has(id)) continue;
    console.log(`--- ${id} ---`);
    const rows = await run();
    all.push(...rows);
    for (const r of rows) {
      console.log(
        `  ${r.scenario.padEnd(20)} ${fmtOps(r.results.opsPerSecond ?? 0)} ops/s`,
      );
    }
    console.log("");
  }

  if (all.length === 0) {
    throw new Error(`No ORMs matched ORMS=${process.env.ORMS ?? ""}`);
  }

  const { suitePath } = await writeSuiteResults(all);
  console.log(`wrote ${all.length} results`);
  console.log(`suite: ${suitePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
