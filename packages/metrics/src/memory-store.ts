import type { MetricsEntryRecord, MetricsValueRecord } from "./types.ts";

/**
 * In-memory Metrics store (tests + default driver).
 */
export class MemoryMetricsStore {
  #entries: MetricsEntryRecord[] = [];
  #values: MetricsValueRecord[] = [];

  store(entries: MetricsEntryRecord[], values: MetricsValueRecord[]): void {
    this.#entries.push(...entries);
    this.#values.push(...values);
  }

  entries(type?: string): MetricsEntryRecord[] {
    if (!type) return [...this.#entries];
    return this.#entries.filter((e) => e.type === type);
  }

  values(type?: string): MetricsValueRecord[] {
    if (!type) return [...this.#values];
    return this.#values.filter((v) => v.type === type);
  }

  flush(): void {
    this.#entries = [];
    this.#values = [];
  }
}
