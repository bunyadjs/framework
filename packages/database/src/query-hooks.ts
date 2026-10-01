import type { Connection } from "./connection.ts";

export type QueryWriteOp = "insert" | "update" | "delete";

export type QueryWriteEvent = {
  table: string;
  op: QueryWriteOp;
  connection: Connection;
  /** Insert/update payload. */
  values?: Record<string, unknown>;
  /** Matching rows (insert: the inserted row; update/delete: rows before the write). */
  rows: Record<string, unknown>[];
};

export type QueryWriteHook = (event: QueryWriteEvent) => void | Promise<void>;

export type QueryInsertHook = (
  table: string,
  values: Record<string, unknown>,
  connection: Connection,
) => void | Promise<void>;

let hook: QueryWriteHook | null = null;
let skipDepth = 0;

/** Register a listener for query-builder insert/update/delete. */
export function setQueryWriteHook(next: QueryWriteHook | null): void {
  hook = next;
}

/** Register an insert-only listener (wraps {@link setQueryWriteHook}). */
export function setQueryInsertHook(next: QueryInsertHook | null): void {
  if (!next) {
    hook = null;
    return;
  }
  hook = (event) => {
    if (event.op !== "insert" || !event.values) return;
    return next(event.table, event.values, event.connection);
  };
}

/** Skip write hooks (model persistence already fires model events). */
export function withoutQueryWriteHook<T>(
  callback: () => T | Promise<T>,
): T | Promise<T> {
  if (!hook) return callback();
  skipDepth += 1;
  try {
    const result = callback();
    if (result instanceof Promise) {
      return result.finally(() => {
        skipDepth -= 1;
      });
    }
    skipDepth -= 1;
    return result;
  } catch (error) {
    skipDepth -= 1;
    throw error;
  }
}

/** @deprecated Use {@link withoutQueryWriteHook}. */
export const withoutQueryInsertHook = withoutQueryWriteHook;

export function shouldPreviewQueryWrite(): boolean {
  return hook != null && skipDepth === 0;
}

export function fireQueryWriteHook(
  event: QueryWriteEvent,
): void | Promise<void> {
  if (!hook || skipDepth > 0) return;
  return hook(event);
}

export function fireQueryInsertHook(
  table: string,
  values: Record<string, unknown>,
  connection: Connection,
): void | Promise<void> {
  return fireQueryWriteHook({
    table,
    op: "insert",
    connection,
    values,
    rows: [values],
  });
}
