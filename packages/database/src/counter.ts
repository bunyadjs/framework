import type { Connection } from "./connection-contract.ts";
import { getDefaultConnection } from "./db.ts";
import { transactionStore } from "./transaction-context.ts";

/** What a counter needs of a connection; a transaction handle fits. */
export type CounterConnection = Pick<Connection, "driver" | "all" | "run" | "exec">;

export type CounterOptions = {
  /** Where to count. Default: the default connection. Pass a transaction to take part in it. */
  connection?: CounterConnection;
  /** The table that holds the counters. Default `counters`. */
  table?: string;
  /** The number to start from when the counter is new. Default 1. */
  start?: number;
  /**
   * For a counter that is new but whose numbers already exist (an old table): returns the highest
   * number in use, so counting goes on from the next one. It is asked for only when the counter has
   * no row yet, so the work of finding it is paid once.
   */
  seed?: () => number | Promise<number>;
  /** Create the table when it is missing. Default true. */
  install?: boolean;
};

const DEFAULT_TABLE = "counters";

function tableName(options: CounterOptions): string {
  const table = options.table ?? DEFAULT_TABLE;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Invalid counter table name [${table}].`);
  }
  return table;
}

function connectionOf(options: CounterOptions): CounterConnection {
  const connection = options.connection ?? (getDefaultConnection() as CounterConnection | undefined);
  if (!connection) throw new Error("Counter needs a connection.");
  if (connection.driver !== "sqlite" && connection.driver !== "postgres") {
    throw new Error(`Counter supports sqlite and postgres, not ${connection.driver}.`);
  }
  return connection;
}

/**
 * Where the table is known to exist, per table. The memory is kept on the connection, or, inside a
 * transaction, on the transaction: a table made in a transaction goes with it if it is rolled back,
 * so nothing outlives it.
 */
const installed = new WeakMap<object, Set<string>>();

const CREATE = (table: string): string =>
  `CREATE TABLE IF NOT EXISTS ${table} (scope VARCHAR(191) NOT NULL, name VARCHAR(191) NOT NULL, value BIGINT NOT NULL, PRIMARY KEY (scope, name))`;

/**
 * Make the counters table when it is missing. Safe to call any number of times, and from many
 * callers or processes at once.
 *
 * Postgres lets two sessions that run `CREATE TABLE IF NOT EXISTS` together collide on its catalog,
 * so the table is looked for first, and made inside one statement that first takes an advisory lock
 * (held until the statement, or the surrounding transaction, ends), which makes the others wait and
 * then find it there.
 */
async function ensureTable(connection: CounterConnection, table: string): Promise<void> {
  const holder: object = transactionStore() ?? connection;
  let known = installed.get(holder);
  if (known?.has(table)) return;

  if (connection.driver === "postgres") {
    const found = await connection.all(`SELECT to_regclass(?) AS name`, [table]);
    if (found[0]?.name === null || found[0]?.name === undefined) {
      await connection.exec(
        `DO $$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('bunyad_counter_install_${table}')); ${CREATE(table)}; END $$`,
      );
    }
  } else {
    await connection.exec(CREATE(table));
  }

  if (!known) {
    known = new Set();
    installed.set(holder, known);
  }
  known.add(table);
}

async function prepare(options: CounterOptions): Promise<{ connection: CounterConnection; table: string }> {
  const table = tableName(options);
  const connection = connectionOf(options);
  if (options.install !== false) await ensureTable(connection, table);
  return { connection, table };
}

function first(rows: Array<Record<string, unknown>>): number | null {
  const value = rows[0]?.value;
  return value === undefined || value === null ? null : Number(value);
}

/**
 * Numbers that count up for ever, such as invoice and receipt numbers.
 *
 * Each counter is one row, found by `scope` (a shop, a tenant) and `name` (what is counted) and
 * advanced with a single statement, so the cost does not depend on how many numbers were handed out,
 * two callers at once can never get the same number, and used inside a transaction a number that
 * is rolled back is not used up. SQLite and Postgres are supported.
 *
 * ```ts
 * const number = await Counter.next(tenantId, "sales-invoice");
 * ```
 */
export const Counter = {
  /** The next number for `scope` and `name`. */
  async next(scope: string, name: string, options: CounterOptions = {}): Promise<number> {
    const { connection, table } = await prepare(options);
    const advanced = first(
      await connection.all(`UPDATE ${table} SET value = value + 1 WHERE scope = ? AND name = ? RETURNING value`, [scope, name]),
    );
    if (advanced !== null) return advanced;

    // A new counter. If another caller creates it first, the conflict adds one to theirs instead.
    const highest = options.seed ? Number(await options.seed()) : 0;
    const begin = options.seed
      ? (Number.isFinite(highest) && highest > 0 ? Math.floor(highest) : 0) + 1
      : Math.floor(options.start ?? 1);
    const created = first(
      await connection.all(
        `INSERT INTO ${table} (scope, name, value) VALUES (?, ?, ?) ON CONFLICT (scope, name) DO UPDATE SET value = ${table}.value + 1 RETURNING value`,
        [scope, name, begin],
      ),
    );
    if (created === null) throw new Error("Counter could not be advanced.");
    return created;
  },

  /** The last number handed out, without counting; `null` before the first. */
  async peek(scope: string, name: string, options: CounterOptions = {}): Promise<number | null> {
    const { connection, table } = await prepare(options);
    return first(await connection.all(`SELECT value FROM ${table} WHERE scope = ? AND name = ?`, [scope, name]));
  },

  /** Put a counter at `value`: the next number is `value + 1`. For importing existing data. */
  async set(scope: string, name: string, value: number, options: CounterOptions = {}): Promise<void> {
    const { connection, table } = await prepare(options);
    await connection.run(
      `INSERT INTO ${table} (scope, name, value) VALUES (?, ?, ?) ON CONFLICT (scope, name) DO UPDATE SET value = excluded.value`,
      [scope, name, Math.floor(value)],
    );
  },

  /** Forget a counter, so it starts again (or is seeded again). */
  async reset(scope: string, name: string, options: CounterOptions = {}): Promise<void> {
    const { connection, table } = await prepare(options);
    await connection.run(`DELETE FROM ${table} WHERE scope = ? AND name = ?`, [scope, name]);
  },

  /** Make the table now (for a boot step or a migration) rather than on first use. */
  async install(options: CounterOptions = {}): Promise<void> {
    await ensureTable(connectionOf(options), tableName(options));
  },
};
