/**
 * Shared Bunyad connection for Next.js (Node runtime).
 *
 * Copy to e.g. `lib/db.ts` in a Next app. The `"server-only"` import fails the
 * build if this module is pulled into a Client Component or client bundle.
 */
import "server-only";

import {
  connect,
  connectFromEnv,
  setDefaultConnection,
  DatabaseManager,
  type Connection,
} from "@bunyad/database";

/**
 * One module-level pool/connection for the Node process.
 * Next may reuse the same module across requests in a long-lived server.
 */
const globalForBunyad = globalThis as typeof globalThis & {
  __bunyadConnection?: Connection;
};

function createConnection(): Connection {
  // Prefer explicit config in apps; env helper matches Bun parity (ADR-007).
  if (process.env.DATABASE_URL || process.env.DB_URL || process.env.DB_CONNECTION) {
    return connectFromEnv();
  }
  return connect({
    driver: "postgres",
    url: process.env.DATABASE_URL,
    max: 10,
  });
}

export function getConnection(): Connection {
  if (!globalForBunyad.__bunyadConnection) {
    globalForBunyad.__bunyadConnection = createConnection();
    setDefaultConnection(globalForBunyad.__bunyadConnection);
  }
  return globalForBunyad.__bunyadConnection;
}

export function db(): DatabaseManager {
  return new DatabaseManager(getConnection());
}

/** Optional: close on process shutdown (not required for short serverless invocations). */
export async function closeConnection(): Promise<void> {
  const connection = globalForBunyad.__bunyadConnection;
  if (!connection) return;
  await connection.close();
  globalForBunyad.__bunyadConnection = undefined;
}
