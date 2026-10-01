/**
 * Shared Bunyad connection for the Express (Node) example.
 *
 * Defaults to SQLite under this package (`database/app.sqlite`).
 * Override with `BUNYAD_SQLITE_PATH`, or set `DATABASE_URL` / `DB_*` to use
 * `connectFromEnv()` (Postgres, MySQL, etc.).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  connectFromEnv,
  connectSqlite,
  type Connection,
} from "@bunyad/database";
import { Model } from "@bunyad/orm";

const exampleRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSqlitePath = join(exampleRoot, "database", "app.sqlite");

/** Process-wide connection; set on first {@link getConnection} call. */
export let connection: Connection | undefined;

function createConnection(): Connection {
  if (
    process.env.DATABASE_URL ||
    process.env.DB_URL ||
    process.env.DB_CONNECTION
  ) {
    return connectFromEnv();
  }
  const path = process.env.BUNYAD_SQLITE_PATH ?? defaultSqlitePath;
  return connectSqlite({ path });
}

/** Open (or return) the process-wide connection and point models at it. */
export function getConnection(): Connection {
  if (!connection) {
    connection = createConnection();
    Model.setConnection(connection);
  }
  return connection;
}

export async function close(): Promise<void> {
  if (!connection) return;
  await connection.close();
  connection = undefined;
}
