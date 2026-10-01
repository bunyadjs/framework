/** Fired when a cache key is found. */
export class CacheHit {
  constructor(
    readonly key: string,
    readonly value: unknown,
    readonly store: string | null = null,
  ) {}
}

/** Fired when a cache key is missing. */
export class CacheMissed {
  constructor(
    readonly key: string,
    readonly store: string | null = null,
  ) {}
}

/** Fired after a successful write. */
export class KeyWritten {
  constructor(
    readonly key: string,
    readonly value: unknown,
    readonly seconds: number | null = null,
    readonly store: string | null = null,
  ) {}
}

/** Fired after a key is forgotten. */
export class KeyForgotten {
  constructor(
    readonly key: string,
    readonly store: string | null = null,
  ) {}
}

/** Fired after the store is flushed. */
export class CacheFlushed {
  constructor(readonly store: string | null = null) {}
}

export type CacheEvent =
  | CacheHit
  | CacheMissed
  | KeyWritten
  | KeyForgotten
  | CacheFlushed;

export type CacheEventDispatcher = {
  dispatch(event: object): unknown | Promise<unknown>;
};

let eventsEnabled = false;
let dispatcher: CacheEventDispatcher | undefined;

/** Enable or disable cache hit/miss/write events. */
export function setCacheEventsEnabled(enabled: boolean): void {
  eventsEnabled = enabled;
}

export function areCacheEventsEnabled(): boolean {
  return eventsEnabled;
}

/** Live a dispatcher (typically `Event` from `@bunyad/events`). */
export function setCacheEventDispatcher(
  next: CacheEventDispatcher | undefined,
): void {
  dispatcher = next;
}

export async function dispatchCacheEvent(event: CacheEvent): Promise<void> {
  if (!eventsEnabled || !dispatcher) return;
  await dispatcher.dispatch(event);
}
