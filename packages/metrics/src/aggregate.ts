import type { MetricsEntryRecord } from "./types.ts";

export type MetricsAggregateRow = {
  type: string;
  key: string;
  count: number;
  sum: number;
  min: number;
  max: number;
  avg: number;
};

/** Roll stored entries into per-key aggregates. */
export function aggregateEntries(
  entries: MetricsEntryRecord[],
  type?: string,
): MetricsAggregateRow[] {
  const filtered = type ? entries.filter((e) => e.type === type) : entries;
  const map = new Map<string, MetricsAggregateRow>();

  for (const entry of filtered) {
    const id = `${entry.type}::${entry.key}`;
    let row = map.get(id);
    if (!row) {
      row = {
        type: entry.type,
        key: entry.key,
        count: 0,
        sum: 0,
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        avg: 0,
      };
      map.set(id, row);
    }
    row.count += 1;
    row.sum += entry.value;
    row.min = Math.min(row.min, entry.value);
    row.max = Math.max(row.max, entry.value);
  }

  return [...map.values()].map((row) => {
    if (!Number.isFinite(row.min)) row.min = 0;
    if (!Number.isFinite(row.max)) row.max = 0;
    row.avg = row.count > 0 ? row.sum / row.count : 0;
    return row;
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Minimal HTML dashboard for ingested Metrics metrics. */
export function renderMetricsDashboard(options: {
  title?: string;
  aggregates: MetricsAggregateRow[];
  values?: { type: string; key: string; value: string }[];
}): string {
  const title = options.title ?? "Metrics";
  const rows = options.aggregates
    .map(
      (row) => `<tr>
  <td>${escapeHtml(row.type)}</td>
  <td>${escapeHtml(row.key)}</td>
  <td>${row.count}</td>
  <td>${row.sum}</td>
  <td>${row.min}</td>
  <td>${row.max}</td>
  <td>${Number(row.avg.toFixed(2))}</td>
</tr>`,
    )
    .join("\n");

  const valueRows = (options.values ?? [])
    .map(
      (v) =>
        `<tr><td>${escapeHtml(v.type)}</td><td>${escapeHtml(v.key)}</td><td>${escapeHtml(v.value)}</td></tr>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f6f6f6; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <h2>Aggregates</h2>
  <table>
    <thead><tr><th>Type</th><th>Key</th><th>Count</th><th>Sum</th><th>Min</th><th>Max</th><th>Avg</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="7">No entries yet.</td></tr>'}</tbody>
  </table>
  <h2>Values</h2>
  <table>
    <thead><tr><th>Type</th><th>Key</th><th>Value</th></tr></thead>
    <tbody>${valueRows || '<tr><td colspan="3">No values yet.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
}
