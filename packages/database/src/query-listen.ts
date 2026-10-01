import type { Connection } from "./connection-contract.ts";

/** Fired after a connection run/get/all/exec (and sync variants) completes. */
export type QueryExecutedEvent = {
  sql: string;
  bindings: unknown[];
  timeMs: number;
  connection: Connection;
};

export type QueryExecutedListener = (event: QueryExecutedEvent) => void;

const listeners = new Set<QueryExecutedListener>();

/** Register a thin query timing listener. Returns unsubscribe. */
export function listen(callback: QueryExecutedListener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Clear all query listeners (tests). */
export function clearQueryListeners(): void {
  listeners.clear();
}

export function hasQueryListeners(): boolean {
  return listeners.size > 0;
}

export function fireQueryExecuted(event: QueryExecutedEvent): void {
  if (listeners.size === 0) return;
  for (const listener of listeners) {
    listener(event);
  }
}
