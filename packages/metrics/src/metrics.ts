import type { Router } from "@bunyad/router";
import {
  aggregateEntries,
  renderMetricsDashboard,
} from "./aggregate.ts";
import {
  registerMetricsRoutes,
  type MetricsRoutesOptions,
} from "./dashboard.ts";
import { Entry } from "./entry.ts";
import { MemoryMetricsStore } from "./memory-store.ts";
import {
  getMetrics,
  MetricsManager,
  setMetrics,
} from "./manager.ts";
import type { MetricsIngest } from "./redis-ingest.ts";
import type { MetricsFilter, MetricsStore } from "./types.ts";

/**
 * `Metrics` facade — recording API + optional dashboard.
 */
export const Metrics = {
  record(
    type: string,
    key: string,
    value = 0,
    timestamp?: number,
  ): Entry {
    return getMetrics().record(type, key, value, timestamp);
  },

  set(type: string, key: string, value: string, timestamp?: number): MetricsManager {
    return getMetrics().set(type, key, value, timestamp);
  },

  lazy(callback: () => void | Promise<void>): MetricsManager {
    return getMetrics().lazy(callback);
  },

  filter(callback: MetricsFilter): MetricsManager {
    return getMetrics().filter(callback);
  },

  report(error: Error | string): MetricsManager {
    return getMetrics().report(error);
  },

  ingest(): Promise<void> {
    return getMetrics().ingest();
  },

  /** Drain Redis (or other) ingest into the store — `metrics:work`. */
  work(limit = 100): Promise<number> {
    return getMetrics().work(limit);
  },

  ignore(): MetricsManager {
    return getMetrics().ignore();
  },

  useStore(store: MetricsStore): MetricsManager {
    return getMetrics().useStore(store);
  },

  useIngest(ingest: MetricsIngest | null): MetricsManager {
    return getMetrics().useIngest(ingest);
  },

  store(): MetricsStore {
    return getMetrics().store();
  },

  /** Swap to a fresh in-memory manager (tests). */
  fake(): MetricsManager {
    const next = new MetricsManager(new MemoryMetricsStore());
    setMetrics(next);
    return next;
  },

  /** Restore default in-memory manager. */
  restore(): MetricsManager {
    const next = new MetricsManager(new MemoryMetricsStore());
    setMetrics(next);
    return next;
  },

  flush(): MetricsManager {
    return getMetrics().flush();
  },

  /** Aggregated metrics from the store. */
  aggregate(type?: string) {
    return getMetrics().aggregate(type);
  },

  /** Minimal HTML dashboard string. */
  html(title = "Metrics"): string {
    const store = getMetrics().store();
    return renderMetricsDashboard({
      title,
      aggregates: aggregateEntries(store.entries()),
      values: store.values(),
    });
  },

  /** Register `/metrics` dashboard routes. */
  routes(router: Router, options?: MetricsRoutesOptions): void {
    registerMetricsRoutes(router, options);
  },

  getMetrics,
  setMetrics,
};
