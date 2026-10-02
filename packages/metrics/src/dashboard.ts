import type { Router } from "@bunyad/router";
import {
  aggregateEntries,
  renderMetricsDashboard,
  type MetricsAggregateRow,
} from "./aggregate.ts";
import { getMetrics } from "./manager.ts";

export type MetricsRoutesOptions = {
  /** Dashboard path (default `/metrics`). */
  path?: string;
  title?: string;
};

let dashboardTitle = "Metrics";
let dashboardPath = "/metrics";

export function configureMetricsHttp(options: MetricsRoutesOptions = {}): void {
  if (options.title) dashboardTitle = options.title;
  if (options.path) dashboardPath = options.path;
}

/**
 * Optional Metrics HTTP dashboard + JSON aggregates.
 * Register via `Metrics.routes(router)` (uses `[MetricsController, method]`).
 */
export default class MetricsController {
  async dashboard() {
    const store = getMetrics().store();
    const html = renderMetricsDashboard({
      title: dashboardTitle,
      aggregates: aggregateEntries(store.entries()),
      values: store.values(),
    });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  async aggregates() {
    const store = getMetrics().store();
    const rows: MetricsAggregateRow[] = aggregateEntries(store.entries());
    return Response.json({
      aggregates: rows,
      values: store.values(),
    });
  }
}

/** Register `/metrics` (HTML) + `/metrics/aggregates` (JSON). */
export function registerMetricsRoutes(
  router: Router,
  options: MetricsRoutesOptions = {},
): void {
  configureMetricsHttp(options);
  const path = options.path ?? dashboardPath;
  router.get(path, [MetricsController, "dashboard"]).name("metrics.dashboard");
  router
    .get(`${path}/aggregates`, [MetricsController, "aggregates"])
    .name("metrics.aggregates");
}

export { MetricsController as MetricsControllerClass };
