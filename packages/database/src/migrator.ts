import { resolve } from "node:path";
import type { Connection } from "./connection.ts";
import { createGlob } from "./platforms/index.ts";
import { Schema, schemaFor } from "./schema.ts";

export type MigrationModule = {
  up: (schema: Schema) => void | Promise<void>;
  down?: (schema: Schema) => void | Promise<void>;
};

/**
 * Tracking-table mapping. Defaults: table `migrations`, columns `migration` + `batch`.
 * An app can use `{ table: "_schema_migrations", migrationColumn: "name", batchColumn: false }`.
 */
export type MigratorOptions = {
  table?: string;
  migrationColumn?: string;
  /** Set `false` when the table has no batch column. */
  batchColumn?: string | false;
};

type ResolvedMigrator = {
  table: string;
  migrationColumn: string;
  batchColumn: string | false;
};

function resolveMigratorOptions(options?: MigratorOptions): ResolvedMigrator {
  return {
    table: options?.table ?? "migrations",
    migrationColumn: options?.migrationColumn ?? "migration",
    batchColumn:
      options?.batchColumn === undefined ? "batch" : options.batchColumn,
  };
}

function isDefaultMigrationsTable(opts: ResolvedMigrator): boolean {
  return (
    opts.table === "migrations" &&
    opts.migrationColumn === "migration" &&
    opts.batchColumn === "batch"
  );
}

function q(connection: Connection, name: string): string {
  return connection.dialect.quoteIdentifier(name);
}

function customMigrationsTableSql(
  connection: Connection,
  opts: ResolvedMigrator,
): string {
  const driver = connection.dialect.driver;
  const table = q(connection, opts.table);
  const mig = q(connection, opts.migrationColumn);
  const appliedAt = q(connection, "applied_at");

  if (opts.batchColumn === false) {
    if (driver === "sqlite") {
      return `CREATE TABLE IF NOT EXISTS ${table} (${mig} TEXT PRIMARY KEY, ${appliedAt} TEXT DEFAULT (CURRENT_TIMESTAMP))`;
    }
    if (driver === "postgres") {
      return `CREATE TABLE IF NOT EXISTS ${table} (${mig} VARCHAR(255) PRIMARY KEY, ${appliedAt} TIMESTAMPTZ DEFAULT NOW())`;
    }
    if (driver === "sqlsrv") {
      return `IF OBJECT_ID(N'${opts.table}', N'U') IS NULL CREATE TABLE ${table} (${mig} NVARCHAR(255) PRIMARY KEY, ${appliedAt} DATETIME2 DEFAULT GETDATE())`;
    }
    return `CREATE TABLE IF NOT EXISTS ${table} (${mig} VARCHAR(255) PRIMARY KEY, ${appliedAt} TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`;
  }

  const batch = q(connection, opts.batchColumn);
  if (driver === "sqlite") {
    return `CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${mig} TEXT NOT NULL UNIQUE, ${batch} INTEGER NOT NULL)`;
  }
  if (driver === "postgres") {
    return `CREATE TABLE IF NOT EXISTS ${table} (id BIGSERIAL PRIMARY KEY, ${mig} VARCHAR(255) NOT NULL UNIQUE, ${batch} INTEGER NOT NULL)`;
  }
  if (driver === "sqlsrv") {
    return `IF OBJECT_ID(N'${opts.table}', N'U') IS NULL CREATE TABLE ${table} (id BIGINT IDENTITY(1,1) PRIMARY KEY, ${mig} NVARCHAR(255) NOT NULL UNIQUE, ${batch} INT NOT NULL)`;
  }
  return `CREATE TABLE IF NOT EXISTS ${table} (id BIGINT PRIMARY KEY AUTO_INCREMENT, ${mig} VARCHAR(255) NOT NULL UNIQUE, ${batch} INT NOT NULL)`;
}

async function ensureMigrationsTable(
  connection: Connection,
  opts: ResolvedMigrator,
): Promise<void> {
  if (isDefaultMigrationsTable(opts)) {
    await connection.exec(connection.dialect.migrationsTableSql());
    return;
  }
  await connection.exec(customMigrationsTableSql(connection, opts));
}

async function listAppliedNames(
  connection: Connection,
  opts: ResolvedMigrator,
): Promise<string[]> {
  const sql = `SELECT ${q(connection, opts.migrationColumn)} AS migration FROM ${q(connection, opts.table)}`;
  const rows = await connection.all<{ migration: string }>(sql);
  return rows.map((r) => r.migration);
}

async function nextBatch(
  connection: Connection,
  opts: ResolvedMigrator,
): Promise<number> {
  if (opts.batchColumn === false) return 1;
  const sql = `SELECT COALESCE(MAX(${q(connection, opts.batchColumn)}), 0) as batch FROM ${q(connection, opts.table)}`;
  const batchRow = await connection.get<{ batch: number }>(sql);
  return (batchRow?.batch ?? 0) + 1;
}

async function recordMigration(
  connection: Connection,
  opts: ResolvedMigrator,
  name: string,
  batch: number,
): Promise<void> {
  const table = q(connection, opts.table);
  const mig = q(connection, opts.migrationColumn);
  if (opts.batchColumn === false) {
    await connection.run(`INSERT INTO ${table} (${mig}) VALUES (?)`, [name]);
    return;
  }
  const batchCol = q(connection, opts.batchColumn);
  await connection.run(
    `INSERT INTO ${table} (${mig}, ${batchCol}) VALUES (?, ?)`,
    [name, batch],
  );
}

async function deleteMigration(
  connection: Connection,
  opts: ResolvedMigrator,
  name: string,
): Promise<void> {
  await connection.run(
    `DELETE FROM ${q(connection, opts.table)} WHERE ${q(connection, opts.migrationColumn)} = ?`,
    [name],
  );
}

async function listMigrationFiles(migrationsPath: string): Promise<string[]> {
  const glob = createGlob("*.ts");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: migrationsPath })) {
    files.push(file);
  }
  files.sort();
  return files;
}

async function applyPending(
  connection: Connection,
  pending: Array<{ name: string; up: MigrationModule["up"] }>,
  opts: ResolvedMigrator,
): Promise<string[]> {
  await ensureMigrationsTable(connection, opts);
  const ran = new Set(await listAppliedNames(connection, opts));
  const batch = await nextBatch(connection, opts);
  const schema = schemaFor(connection);
  const applied: string[] = [];

  for (const entry of pending) {
    if (ran.has(entry.name)) continue;
    await entry.up(schema);
    await recordMigration(connection, opts, entry.name, batch);
    applied.push(entry.name);
  }

  return applied;
}

/**
 * Run pending migration files (sorted by filename).
 */
export async function migrate(
  connection: Connection,
  migrationsPath: string,
  options?: MigratorOptions,
): Promise<string[]> {
  const opts = resolveMigratorOptions(options);
  const files = await listMigrationFiles(migrationsPath);
  return applyPending(
    connection,
    files.map((name) => ({
      name,
      up: async (schema) => {
        const mod = (await import(
          resolve(migrationsPath, name)
        )) as MigrationModule;
        await mod.up(schema);
      },
    })),
    opts,
  );
}

export type CompiledMigration = {
  /** Stored name (usually `*.ts` filename). */
  migration: string;
  up: (schema: Schema) => void | Promise<void>;
  down?: (schema: Schema) => void | Promise<void>;
};

/**
 * Run pending migrations from an in-memory list (standalone / compiled apps).
 */
export async function migrateCompiled(
  connection: Connection,
  migrations: CompiledMigration[],
  options?: MigratorOptions,
): Promise<string[]> {
  const opts = resolveMigratorOptions(options);
  return applyPending(
    connection,
    migrations.map((entry) => ({
      name: entry.migration,
      up: entry.up,
    })),
    opts,
  );
}

type MigrateGlobal = typeof globalThis & {
  __bunyad_preloaded_migrations?: CompiledMigration[];
};

/** Register compiled migrations before `DatabaseServiceProvider` boots. */
export function setPreloadedMigrations(
  migrations: CompiledMigration[],
): void {
  (globalThis as MigrateGlobal).__bunyad_preloaded_migrations = migrations;
}

export function takePreloadedMigrations(): CompiledMigration[] | undefined {
  const g = globalThis as MigrateGlobal;
  const list = g.__bunyad_preloaded_migrations;
  delete g.__bunyad_preloaded_migrations;
  return list;
}

async function filesInLastBatch(
  connection: Connection,
  opts: ResolvedMigrator,
): Promise<string[]> {
  if (opts.batchColumn === false) {
    const rows = await connection.all<{ migration: string }>(
      `SELECT ${q(connection, opts.migrationColumn)} AS migration FROM ${q(connection, opts.table)} ORDER BY ${q(connection, opts.migrationColumn)} DESC LIMIT 1`,
    );
    return rows.map((r) => r.migration);
  }

  const batchRow = await connection.get<{ batch: number | null }>(
    `SELECT MAX(${q(connection, opts.batchColumn)}) as batch FROM ${q(connection, opts.table)}`,
  );
  const batch = batchRow?.batch;
  if (batch == null) return [];

  const files = await connection.all<{ migration: string }>(
    `SELECT ${q(connection, opts.migrationColumn)} AS migration FROM ${q(connection, opts.table)} WHERE ${q(connection, opts.batchColumn)} = ? ORDER BY ${q(connection, opts.migrationColumn)} DESC`,
    [batch],
  );
  return files.map((r) => r.migration);
}

/**
 * Roll back the last batch (`steps` batches when > 1).
 * Without a batch column, each step rolls back one migration (filename DESC).
 */
export async function rollback(
  connection: Connection,
  migrationsPath: string,
  steps = 1,
  options?: MigratorOptions,
): Promise<string[]> {
  const opts = resolveMigratorOptions(options);
  await ensureMigrationsTable(connection, opts);
  const schema = schemaFor(connection);
  const rolledBack: string[] = [];

  for (let step = 0; step < steps; step++) {
    const files = await filesInLastBatch(connection, opts);
    if (files.length === 0) break;

    for (const migration of files) {
      const mod = (await import(
        resolve(migrationsPath, migration)
      )) as MigrationModule;
      if (mod.down) await mod.down(schema);
      await deleteMigration(connection, opts, migration);
      rolledBack.push(migration);
    }
  }

  return rolledBack;
}

/**
 * Drop all migrated tables and re-run migrations (`migrate:fresh`).
 */
export async function fresh(
  connection: Connection,
  migrationsPath: string,
  options?: MigratorOptions,
): Promise<string[]> {
  await wipe(connection);
  return migrate(connection, migrationsPath, options);
}

/**
 * Drop every user table (`db:wipe`).
 */
export async function wipe(connection: Connection): Promise<string[]> {
  const { sql, params } = connection.dialect.listTablesSql();
  const tables = await connection.all<{ name: string }>(sql, params);
  const disable = connection.dialect.disableForeignKeysSql();
  const enable = connection.dialect.enableForeignKeysSql();
  if (disable) await connection.exec(disable);
  for (const { name } of tables) {
    const quoted = connection.dialect.quoteIdentifier(name);
    await connection.exec(`DROP TABLE IF EXISTS ${quoted}`);
  }
  if (enable) await connection.exec(enable);
  return tables.map((t) => t.name);
}

export type MigrationStatus = {
  migration: string;
  batch: number | null;
};

/**
 * List migration files and whether each has run (`migrate:status`).
 */
export async function status(
  connection: Connection,
  migrationsPath: string,
  options?: MigratorOptions,
): Promise<MigrationStatus[]> {
  const opts = resolveMigratorOptions(options);
  await ensureMigrationsTable(connection, opts);

  const ran = new Map<string, number>();
  if (opts.batchColumn === false) {
    for (const name of await listAppliedNames(connection, opts)) {
      ran.set(name, 1);
    }
  } else {
    const orderBy =
      isDefaultMigrationsTable(opts) || opts.batchColumn
        ? `ORDER BY ${isDefaultMigrationsTable(opts) ? "id" : q(connection, opts.migrationColumn)}`
        : "";
    const rows = await connection.all<{ migration: string; batch: number }>(
      `SELECT ${q(connection, opts.migrationColumn)} AS migration, ${q(connection, opts.batchColumn)} AS batch FROM ${q(connection, opts.table)} ${orderBy}`,
    );
    for (const row of rows) {
      ran.set(row.migration, row.batch);
    }
  }

  const files = await listMigrationFiles(migrationsPath);
  return files.map((migration) => ({
    migration,
    batch: ran.get(migration) ?? null,
  }));
}
