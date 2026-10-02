import { Entry } from "./entry.ts";
import { MemoryMetricsStore } from "./memory-store.ts";
import { aggregateEntries, type MetricsAggregateRow } from "./aggregate.ts";
import type { MetricsIngest } from "./redis-ingest.ts";
import type {
  MetricsFilter,
  MetricsStore,
  MetricsValueRecord,
} from "./types.ts";

type LazyCallback = () => void | Promise<void>;

/**
 * Metrics recorder — buffers entries/values until `ingest()`.
 */
export class MetricsManager {
  #store: MetricsStore;
  #ingest: MetricsIngest | null = null;
  #pendingEntries: Entry[] = [];
  #pendingValues: MetricsValueRecord[] = [];
  #lazy: LazyCallback[] = [];
  #filters: MetricsFilter[] = [];
  #exceptions: { message: string; name: string; timestamp: number }[] = [];

  constructor(store: MetricsStore = new MemoryMetricsStore()) {
    this.#store = store;
  }

  useStore(store: MetricsStore): this {
    this.#store = store;
    return this;
  }

  /** Optional Redis (or other) ingest buffer — `work()` drains into the store. */
  useIngest(ingest: MetricsIngest | null): this {
    this.#ingest = ingest;
    return this;
  }

  ingestDriver(): MetricsIngest | null {
    return this.#ingest;
  }

  store(): MetricsStore {
    return this.#store;
  }

  record(
    type: string,
    key: string,
    value = 0,
    timestamp = Math.floor(Date.now() / 1000),
  ): Entry {
    const entry = new Entry(type, String(key), Number(value), timestamp);
    this.#pendingEntries.push(entry);
    return entry;
  }

  set(
    type: string,
    key: string,
    value: string,
    timestamp = Math.floor(Date.now() / 1000),
  ): this {
    this.#pendingValues.push({
      type,
      key: String(key),
      value: String(value),
      timestamp,
    });
    return this;
  }

  lazy(callback: LazyCallback): this {
    this.#lazy.push(callback);
    return this;
  }

  filter(callback: MetricsFilter): this {
    this.#filters.push(callback);
    return this;
  }

  report(error: Error | string): this {
    const err =
      typeof error === "string" ? new Error(error) : error;
    this.#exceptions.push({
      message: err.message,
      name: err.name,
      timestamp: Math.floor(Date.now() / 1000),
    });
    this.record("exception", err.name, 1).count();
    this.set("exception_message", err.name, err.message);
    return this;
  }

  async ingest(): Promise<void> {
    const lazy = this.#lazy.splice(0);
    for (const fn of lazy) {
      await fn();
    }

    let entries = this.#pendingEntries.splice(0).map((e) => e.resolve());
    let values = this.#pendingValues.splice(0);

    for (const filter of this.#filters) {
      entries = entries.filter((e) => filter(e));
      values = values.filter((v) => filter(v));
    }

    if (this.#ingest) {
      await this.#ingest.push({ entries, values });
      return;
    }

    await this.#store.store(entries, values);
  }

  /**
   * Drain the ingest buffer into the store (`metrics:work`).
   * @returns number of batches processed
   */
  async work(limit = 100): Promise<number> {
    if (!this.#ingest) return 0;
    let processed = 0;
    for (let i = 0; i < limit; i++) {
      const batch = await this.#ingest.pull();
      if (!batch) break;
      await this.#store.store(batch.entries, batch.values);
      processed += 1;
    }
    return processed;
  }

  exceptions(): { message: string; name: string; timestamp: number }[] {
    return [...this.#exceptions];
  }

  /** Aggregated rows from the underlying store. */
  aggregate(type?: string): MetricsAggregateRow[] {
    return aggregateEntries(this.#store.entries(), type);
  }

  /** Drop pending buffer without storing. */
  ignore(): this {
    this.#pendingEntries = [];
    this.#pendingValues = [];
    this.#lazy = [];
    return this;
  }

  flush(): this {
    this.ignore();
    this.#exceptions = [];
    this.#filters = [];
    this.#store.flush();
    void this.#ingest?.flush();
    return this;
  }
}

let manager = new MetricsManager();

export function getMetrics(): MetricsManager {
  return manager;
}

export function setMetrics(next: MetricsManager): void {
  manager = next;
}
