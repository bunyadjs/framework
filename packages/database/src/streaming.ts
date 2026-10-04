import type { StreamOptions } from "./connection-contract.ts";

type Row = Record<string, unknown>;

/** Run one statement on a dedicated (reserved) connection and return its rows. */
export type CursorExec = (sql: string, params?: unknown[]) => Promise<Row[]>;

export const DEFAULT_STREAM_CHUNK = 1000;

export function streamChunkSize(options?: StreamOptions): number {
  const size = Math.floor(options?.chunkSize ?? DEFAULT_STREAM_CHUNK);
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_STREAM_CHUNK;
}

let cursorSequence = 0;

/**
 * Stream a query through a Postgres server-side cursor (`DECLARE … CURSOR` +
 * `FETCH FORWARD n`). The caller owns the connection and the surrounding
 * transaction — a cursor only lives inside one — and must run every statement
 * on the same session via `exec`.
 */
export async function* postgresCursorRows(
  exec: CursorExec,
  sql: string,
  params: unknown[],
  chunkSize: number,
): AsyncGenerator<Row, void, unknown> {
  const name = `bunyad_cursor_${++cursorSequence}`;
  await exec(`DECLARE ${name} NO SCROLL CURSOR FOR ${sql}`, params);
  try {
    for (;;) {
      const rows = await exec(`FETCH FORWARD ${chunkSize} FROM ${name}`);
      for (const row of rows) yield row;
      if (rows.length < chunkSize) return;
    }
  } finally {
    // After a failed statement the transaction is aborted and CLOSE errors; the
    // caller's ROLLBACK discards the cursor either way.
    await exec(`CLOSE ${name}`).catch(() => undefined);
  }
}
