import type { AggregateType, MetricsEntryRecord } from "./types.ts";

/**
 * Buffered metric entry (`Metrics::record(...)->count()`).
 */
export class Entry {
  #aggregations = new Set<AggregateType>();

  constructor(
    readonly type: string,
    readonly key: string,
    readonly value: number,
    readonly timestamp: number,
  ) {}

  count(): this {
    this.#aggregations.add("count");
    return this;
  }

  min(): this {
    this.#aggregations.add("min");
    return this;
  }

  max(): this {
    this.#aggregations.add("max");
    return this;
  }

  sum(): this {
    this.#aggregations.add("sum");
    return this;
  }

  avg(): this {
    this.#aggregations.add("avg");
    return this;
  }

  /** Ensure at least one aggregation (default count). */
  resolve(): MetricsEntryRecord {
    if (this.#aggregations.size === 0) this.#aggregations.add("count");
    return {
      type: this.type,
      key: this.key,
      value: this.value,
      timestamp: this.timestamp,
      aggregations: [...this.#aggregations],
    };
  }
}
