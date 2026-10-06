import { CLIENT_CSS, CLIENT_JS } from "./ui-client.ts";
import type { Snapshot } from "./types.ts";

/** JSON that is safe inside an inline script / attribute context. */
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(" ", "\\u2028")
    .replaceAll(" ", "\\u2029");
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHtml(value: string): string {
  return escapeAttr(value).replaceAll("'", "&#39;");
}

/** Markup injected before `</body>`: host element, snapshot data, runtime. */
export function renderBar(snapshot: Snapshot, basePath: string): string {
  return (
    `<div id="bunyad-debugbar" data-base="${escapeAttr(basePath)}" data-css="${escapeAttr(CLIENT_CSS)}"></div>` +
    `<script type="application/json" id="bunyad-debugbar-data">${safeJson(snapshot)}</script>` +
    `<script>${CLIENT_JS}</script>`
  );
}

/** Standalone page listing retained requests (`GET /_debugbar`). */
export function renderHistoryPage(snapshots: Snapshot[], basePath: string): string {
  const rows = snapshots
    .map((s) => {
      const r = s.request;
      const cls = r.status >= 500 ? "bad" : r.status >= 400 ? "warn" : "ok";
      return `<tr>
<td>${escapeHtml(s.collectedAt.slice(11, 19))}</td>
<td>${escapeHtml(r.method)}</td>
<td>${escapeHtml(r.path)}</td>
<td class="${cls}">${r.status}</td>
<td>${r.durationMs.toFixed(1)} ms</td>
<td>${s.queries.count} (${s.queries.totalMs.toFixed(1)} ms)</td>
<td>${s.exceptions.length}</td>
<td><a href="${escapeAttr(basePath)}/${escapeAttr(s.id)}">JSON</a></td></tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bunyad Debugbar</title>
<style>
body{margin:0;background:#10131a;color:#d6dbe4;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace}
main{max-width:1100px;margin:0 auto;padding:24px 16px}h1{font-size:18px;color:#fff;margin:0 0 4px}
p{color:#8a93a6;margin:0 0 18px}table{border-collapse:collapse;width:100%}
th{text-align:left;color:#8a93a6;padding:6px 10px;border-bottom:1px solid #2a2f3a}
td{padding:6px 10px;border-bottom:1px solid #1a1f29}a{color:#6cb6ff}
.ok{color:#7ee2a8}.warn{color:#ffd166}.bad{color:#ff7b8a}
</style></head><body><main>
<h1>Bunyad Debugbar</h1><p>${snapshots.length} retained request(s), newest first. Development only.</p>
<table><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>Queries</th><th>Errors</th><th></th></tr></thead>
<tbody>${rows || '<tr><td colspan="8">No requests recorded yet.</td></tr>'}</tbody></table>
</main></body></html>`;
}
