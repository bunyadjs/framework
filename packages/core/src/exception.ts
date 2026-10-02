import { existsSync, readFileSync } from "node:fs";
import { HttpException, type Request } from "@bunyad/http";
import { BunyadError, report } from "@bunyad/common";

export type StackFrame = {
  functionName: string;
  file: string;
  line: number;
  column: number;
  /** Absolute filesystem path when available. */
  path: string;
};

/** Callback that decides whether an exception should render as JSON. */
export type ShouldRenderJsonWhenCallback = (
  request: Request,
  error: unknown,
) => boolean;

export type ExceptionContext = {
  request?: Request;
  debug?: boolean;
  /** Application name shown in the page chrome. */
  appName?: string;
  env?: string;
  /** Optional `shouldRenderJsonWhen` callback from the application. */
  shouldRenderJsonWhen?: ShouldRenderJsonWhenCallback | null;
  /** When false, skip `report()` even for 5xx. */
  shouldReport?: boolean;
  /** Extra context attached when reporting. */
  reportContext?: Record<string, unknown>;
};

/** Custom renderer; return a Response to handle the error, or void to fall through. */
export type ExceptionRenderer = (
  error: unknown,
  request: Request,
) => Response | void | Promise<Response | void>;

export type ExceptionType = new (...args: never[]) => Error;

/** Return `false` to skip reporting, `true` to force it, void to fall through. */
export type ReportableCallback = (
  error: unknown,
) => boolean | void | Promise<boolean | void>;

export type ExceptionContextCallback = (
  error: unknown,
) =>
  | Record<string, unknown>
  | void
  | Promise<Record<string, unknown> | void>;

/**
 * Whether the exception response should be JSON.
 * Uses `shouldRenderJsonWhen` when set; otherwise `request.expectsJson()`.
 */
export function shouldReturnJson(
  request: Request,
  error: unknown,
  callback?: ShouldRenderJsonWhenCallback | null,
): boolean {
  if (callback) return callback(request, error);
  return request.expectsJson();
}

/**
 * @deprecated Prefer `request.expectsJson()` / `shouldReturnJson`.
 * Kept for callers that only have a Request and no exception context.
 */
export function wantsJson(request: Request): boolean {
  return request.expectsJson();
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Whether a stack frame is application code (not framework / vendor).
 * Prefer these for the editor “blame” location.
 */
export function isApplicationFrame(frame: StackFrame): boolean {
  const p = frame.path.replaceAll("\\", "/");
  if (!p || isVendorPath(p)) return false;
  if (p.endsWith(".view") || p.includes("/resources/views/")) return true;
  if (p.includes("/routes/")) return true;
  if (p.includes("/database/")) return true;
  if (p.includes("/bootstrap/")) return true;
  // apps/playground/app/... or top-level app/...
  if (/(^|\/)app\//.test(p)) return true;
  return false;
}

/** Runtime / package paths that should not be treated as application code. */
export function isVendorPath(path: string): boolean {
  const p = path.replaceAll("\\", "/");
  if (!p) return true;
  if (
    p.startsWith("node:") ||
    p.startsWith("bun:") ||
    p.startsWith("internal:") ||
    p.includes("node:") ||
    p.includes("bun:") ||
    p.includes("internal:")
  ) {
    return true;
  }
  if (p.includes("/node_modules/")) return true;
  // Monorepo framework packages
  if (p.includes("/packages/")) return true;
  return false;
}

function hasReadableSource(path: string): boolean {
  if (!path || isVendorPath(path)) return false;
  if (path.includes("node:") || path.includes("bun:") || path.includes("internal:")) {
    return false;
  }
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

/** First app frame, else first frame with readable source, else the top frame. */
export function pickEditorFrame(
  frames: StackFrame[],
): StackFrame | undefined {
  return (
    frames.find(isApplicationFrame) ??
    frames.find((f) => hasReadableSource(f.path)) ??
    frames[0]
  );
}

/** Walk `error.cause` for nested exceptions (driver errors under QueryException). */
export function exceptionChain(error: unknown, limit = 5): Error[] {
  const out: Error[] = [];
  let current: unknown = error;
  for (let i = 0; i < limit && current != null; i++) {
    if (current instanceof Error) {
      out.push(current);
      current = current.cause;
      continue;
    }
    break;
  }
  return out;
}

type QueryExceptionView = {
  sql: string;
  bindings: unknown[];
  sqlState: string | null;
};

/** Duck-type QueryException without importing `@bunyad/database` into core. */
export function queryExceptionInfo(error: unknown): QueryExceptionView | null {
  if (!(error instanceof Error) || error.name !== "QueryException") return null;
  const row = error as Error & {
    sql?: unknown;
    bindings?: unknown;
    sqlState?: unknown;
  };
  if (typeof row.sql !== "string") return null;
  return {
    sql: row.sql,
    bindings: Array.isArray(row.bindings) ? row.bindings : [],
    sqlState: typeof row.sqlState === "string" ? row.sqlState : null,
  };
}

function sameFrame(a: StackFrame, b: StackFrame): boolean {
  return (
    a.path === b.path &&
    a.line === b.line &&
    a.column === b.column &&
    a.functionName === b.functionName
  );
}

type FrameGroup =
  | { kind: "vendor"; frames: StackFrame[] }
  | { kind: "frame"; frame: StackFrame };

/** Collapse consecutive vendor frames (Ignition-style) while keeping app frames visible. */
export function groupStackFrames(frames: StackFrame[]): FrameGroup[] {
  // Without an application frame, keep every frame visible (e.g. raw driver stacks).
  if (!frames.some(isApplicationFrame)) {
    return frames.map((frame) => ({ kind: "frame" as const, frame }));
  }

  const groups: FrameGroup[] = [];
  let vendorBuf: StackFrame[] = [];

  const flushVendor = (): void => {
    if (vendorBuf.length === 0) return;
    if (vendorBuf.length === 1) {
      groups.push({ kind: "frame", frame: vendorBuf[0]! });
    } else {
      groups.push({ kind: "vendor", frames: vendorBuf });
    }
    vendorBuf = [];
  };

  for (const frame of frames) {
    if (isApplicationFrame(frame)) {
      flushVendor();
      groups.push({ kind: "frame", frame });
    } else {
      vendorBuf.push(frame);
    }
  }
  flushVendor();
  return groups;
}

/** Map thrown values to an HTTP status code. */
export function statusFromError(error: unknown): number {
  if (error instanceof HttpException) return error.status;
  if (
    error instanceof Error &&
    (error.name === "ModelNotFoundException" ||
      error.name === "NotFoundError")
  ) {
    return 404;
  }
  return 500;
}

/** Parse V8 / Bun stack lines into frames. */
export function parseStack(error: Error): StackFrame[] {
  const stack = error.stack ?? "";
  const frames: StackFrame[] = [];
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    if (!line.startsWith("at ")) continue;

    // at fn (file:line:col)  |  at file:line:col
    const withFn =
      /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/.exec(line) ??
      /^at\s+(.+?)\s+\((.+):(\d+)\)$/.exec(line);
    const bare =
      !withFn
        ? (/^at\s+(.+):(\d+):(\d+)$/.exec(line) ??
          /^at\s+(.+):(\d+)$/.exec(line))
        : null;

    let functionName = "<anonymous>";
    let file = "";
    let lineNo = 0;
    let column = 0;

    if (withFn) {
      functionName = withFn[1] ?? functionName;
      file = withFn[2] ?? "";
      lineNo = Number(withFn[3] ?? 0);
      column = Number(withFn[4] ?? 0);
    } else if (bare) {
      file = bare[1] ?? "";
      lineNo = Number(bare[2] ?? 0);
      column = Number(bare[3] ?? 0);
    } else {
      continue;
    }

    const path = file.startsWith("file://")
      ? decodeURIComponent(file.slice("file://".length))
      : file;

    frames.push({
      functionName,
      file,
      line: lineNo,
      column,
      path,
    });
  }
  return frames;
}

function readSnippet(
  path: string,
  line: number,
  radius = 5,
): { start: number; lines: string[] } | null {
  if (
    !path ||
    path.includes("node:") ||
    path.includes("bun:") ||
    path.includes("internal:")
  ) {
    return null;
  }
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, "utf8");
    const all = content.split(/\r?\n/);
    const idx = Math.max(0, line - 1);
    const start = Math.max(0, idx - radius);
    const end = Math.min(all.length, idx + radius + 1);
    return { start: start + 1, lines: all.slice(start, end) };
  } catch {
    return null;
  }
}

function relativeDisplay(path: string): string {
  const cwd = process.cwd().replaceAll("\\", "/");
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith(`${cwd}/`)) {
    return normalized.slice(cwd.length + 1);
  }
  return normalized;
}

function codeBlock(
  snippet: { start: number; lines: string[] },
  highlight: number,
): string {
  const rows = snippet.lines
    .map((text, i) => {
      const n = snippet.start + i;
      const active = n === highlight ? " is-active" : "";
      return `<div class="code-line${active}"><span class="ln">${n}</span><code>${escapeHtml(text)}</code></div>`;
    })
    .join("");
  return `<div class="code">${rows}</div>`;
}

function kvTable(
  title: string,
  rows: [string, string][],
  options: { fullWidth?: boolean } = {},
): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><th>${escapeHtml(k)}</th><td><pre>${escapeHtml(v)}</pre></td></tr>`,
    )
    .join("");
  const full = options.fullWidth ? " card-full" : "";
  return `<section class="card${full}"><h2>${escapeHtml(title)}</h2><table>${body}</table></section>`;
}

function brandMarkHtml(): string {
  return `<section class="brand" aria-label="Bunyad">
  <div class="brand-mark" id="bunyad-brand">
    <p class="brand-base">Bunyad</p>
    <p class="brand-glow" id="bunyad-brand-glow">Bunyad</p>
  </div>
</section>
<script>
(() => {
  const root = document.getElementById("bunyad-brand");
  const glow = document.getElementById("bunyad-brand-glow");
  if (!root || !glow) return;
  const paint = (x, y) => {
    const mask = "radial-gradient(circle at " + x + "px " + y + "px, #000 0%, transparent 140px)";
    glow.style.webkitMaskImage = mask;
    glow.style.maskImage = mask;
  };
  paint(root.clientWidth * 0.35, root.clientHeight * 0.45);
  root.addEventListener("pointermove", (event) => {
    const rect = root.getBoundingClientRect();
    paint(event.clientX - rect.left, event.clientY - rect.top);
  });
})();
</script>`;
}

/**
 * HTML exception page (debug).
 */
export function renderExceptionHtml(
  error: unknown,
  context: ExceptionContext = {},
): string {
  const err =
    error instanceof Error ? error : new Error(String(error ?? "Error"));
  const status = statusFromError(error);
  const debug = context.debug !== false;
  const className = err.name || "Error";
  const message = err.message || String(error);
  const frames = debug ? parseStack(err) : [];
  const editor = pickEditorFrame(frames);
  const editorSnippet =
    editor != null ? readSnippet(editor.path, editor.line) : null;
  const queryInfo = queryExceptionInfo(error);
  const causes = exceptionChain(error).slice(1);

  if (!debug) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${status} — ${escapeHtml(context.appName ?? "Bunyad")}</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --fg:#e8eaed; --muted:#9aa0a6; --card:#1a1d24; --accent:#ef4444; --font: "IBM Plex Sans", "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font-family:var(--font); }
  main { text-align:center; padding:2rem; }
  .code { font-size:4rem; font-weight:700; color:var(--accent); letter-spacing:-0.04em; }
  p { color:var(--muted); margin-top:0.75rem; }
</style>
</head>
<body>
<main>
  <div class="code">${status}</div>
  <h1>${status === 404 ? "Not Found" : "Server Error"}</h1>
  <p>${escapeHtml(context.appName ?? "Bunyad")}</p>
</main>
</body>
</html>`;
  }

  const renderFrame = (frame: StackFrame, open: boolean): string => {
    const snippet = readSnippet(frame.path, frame.line);
    const isApp = isApplicationFrame(frame);
    const loc = `${relativeDisplay(frame.path)}:${frame.line}:${frame.column}`;
    const badge = isApp
      ? `<span class="tag tag-app">app</span>`
      : `<span class="tag tag-vendor">vendor</span>`;
    return `<details class="frame${isApp ? " is-app" : " is-vendor"}"${open ? " open" : ""}>
<summary>
  <span class="fn">${escapeHtml(frame.functionName)}${badge}</span>
  <span class="file">${escapeHtml(loc)}</span>
</summary>
${snippet ? codeBlock(snippet, frame.line) : `<p class="muted">Source unavailable</p>`}
</details>`;
  };

  const frameHtml = groupStackFrames(frames)
    .map((group) => {
      if (group.kind === "vendor") {
        const count = group.frames.length;
        const containsEditor =
          editor != null && group.frames.some((frame) => sameFrame(frame, editor));
        const inner = group.frames
          .map((frame) =>
            renderFrame(
              frame,
              editor != null && sameFrame(frame, editor),
            ),
          )
          .join("");
        return `<details class="vendor-group"${containsEditor ? " open" : ""}>
<summary><span class="vendor-count">${count} vendor frame${count === 1 ? "" : "s"}</span></summary>
<div class="vendor-frames">${inner}</div>
</details>`;
      }
      const isEditor = editor != null && sameFrame(group.frame, editor);
      return renderFrame(group.frame, isEditor);
    })
    .join("");

  const req = context.request;
  const requestRows: [string, string][] = [];
  const headerRows: [string, string][] = [];
  if (req) {
    requestRows.push(["Method", req.method]);
    requestRows.push(["URL", req.url]);
    const route = req.route();
    if (route && typeof route === "object" && Object.keys(route).length) {
      requestRows.push(["Route params", JSON.stringify(route, null, 2)]);
    }
    const query = req.query();
    if (Object.keys(query).length) {
      requestRows.push(["Query", JSON.stringify(query, null, 2)]);
    }
    try {
      for (const [name, value] of req.raw.headers.entries()) {
        headerRows.push([name.toUpperCase(), value]);
      }
    } catch {
      const accept = req.header("accept");
      if (accept) headerRows.push(["Accept", accept]);
      const ua = req.header("user-agent");
      if (ua) headerRows.push(["User-Agent", ua]);
    }
  }

  const appRows: [string, string][] = [
    [
      "Environment",
      context.env ??
        process.env.APP_ENV ??
        process.env.NODE_ENV ??
        "local",
    ],
    [
      "Runtime",
      `Bun ${typeof Bun !== "undefined" ? Bun.version : "unknown"}`,
    ],
  ];
  if (error instanceof BunyadError && error.code) {
    appRows.push(["Error code", error.code]);
  }
  if (queryInfo?.sqlState) {
    appRows.push(["SQLSTATE", queryInfo.sqlState]);
  }

  const queryRows: [string, string][] = [];
  if (queryInfo) {
    queryRows.push(["SQL", queryInfo.sql]);
    if (queryInfo.bindings.length > 0) {
      queryRows.push(["Bindings", JSON.stringify(queryInfo.bindings, null, 2)]);
    }
  }

  const previousHtml = causes
    .map((cause, i) => {
      const causeFrames = parseStack(cause);
      const label =
        causes.length === 1
          ? "Previous exception"
          : `Previous exception #${i + 1}`;
      return `<section class="card previous">
<h2>${escapeHtml(label)}</h2>
<div class="class">${escapeHtml(cause.name || "Error")}</div>
<p class="previous-msg">${escapeHtml(cause.message || String(cause))}</p>
${
  causeFrames.length
    ? `<pre class="previous-stack">${escapeHtml(
        causeFrames
          .slice(0, 8)
          .map(
            (f) =>
              `at ${f.functionName} (${relativeDisplay(f.path)}:${f.line}:${f.column})`,
          )
          .join("\n"),
      )}</pre>`
    : ""
}
</section>`;
    })
    .join("");

  const topLoc = editor
    ? `${relativeDisplay(editor.path)}:${editor.line}`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(className)} — ${escapeHtml(message.slice(0, 80))}</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0b0d10;
    --bg2: #12151a;
    --card: #161a21;
    --border: #2a303b;
    --fg: #eef1f6;
    --muted: #8b93a7;
    --red: #ff5c5c;
    --red-dim: rgba(255,92,92,.12);
    --green: #3dd68c;
    --font: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background:
      radial-gradient(1200px 600px at 10% -10%, #1a2230 0%, transparent 55%),
      var(--bg);
    color: var(--fg);
    font-family: var(--font);
    line-height: 1.45;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  .badge {
    display: inline-flex; align-items: center; gap: .5rem;
    font-size: .75rem; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--red);
    background: var(--red-dim); border: 1px solid rgba(255,92,92,.25);
    padding: .35rem .65rem; border-radius: 999px; margin-bottom: 1rem;
  }
  h1 {
    font-size: clamp(1.35rem, 2.5vw, 1.85rem);
    font-weight: 650; margin: 0 0 .5rem; letter-spacing: -0.02em;
    color: var(--red);
  }
  .class { color: var(--muted); font-size: .95rem; margin-bottom: .35rem; font-family: var(--mono); }
  .top-file {
    color: var(--muted); font-family: var(--mono); font-size: .85rem;
    margin-bottom: 1.5rem; word-break: break-all;
  }
  .hero-code {
    background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; overflow: hidden; margin-bottom: 1.75rem;
  }
  .section-title {
    font-size: .8rem; text-transform: uppercase; letter-spacing: .06em;
    color: var(--muted); margin: 0 0 .75rem; font-weight: 600;
  }
  .frames { display: flex; flex-direction: column; gap: .5rem; margin-bottom: 1.75rem; }
  .frame {
    background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    overflow: hidden;
  }
  .frame.is-vendor { opacity: 0.72; }
  .frame.is-app { opacity: 1; border-color: #3a4556; }
  .frame summary, .vendor-group > summary {
    list-style: none; cursor: pointer; display: flex; flex-wrap: wrap;
    justify-content: space-between; gap: .5rem 1rem; align-items: center;
    padding: .85rem 1rem; font-family: var(--mono); font-size: .82rem;
  }
  .frame summary::-webkit-details-marker,
  .vendor-group > summary::-webkit-details-marker { display: none; }
  .frame .fn { color: var(--fg); font-weight: 600; display: inline-flex; align-items: center; gap: .5rem; }
  .frame .file { color: var(--muted); word-break: break-all; }
  .frame[open] summary { border-bottom: 1px solid var(--border); background: var(--bg2); }
  .vendor-group {
    background: var(--bg2); border: 1px dashed var(--border); border-radius: 10px;
    overflow: hidden;
  }
  .vendor-group > summary { color: var(--muted); }
  .vendor-count { font-weight: 600; }
  .vendor-frames { display: flex; flex-direction: column; gap: .4rem; padding: .5rem; }
  .vendor-frames .frame { opacity: 0.85; }
  .tag {
    font-size: .65rem; font-weight: 700; letter-spacing: .04em;
    text-transform: uppercase; padding: .15rem .4rem; border-radius: 4px;
  }
  .tag-app { background: rgba(61,214,140,.15); color: var(--green); }
  .tag-vendor { background: rgba(139,147,167,.15); color: var(--muted); }
  .code { font-family: var(--mono); font-size: .8rem; padding: .5rem 0; overflow-x: auto; }
  .code-line { display: grid; grid-template-columns: 3.5rem 1fr; gap: .75rem; padding: .15rem 1rem; white-space: pre; }
  .code-line .ln { color: var(--muted); text-align: right; user-select: none; }
  .code-line.is-active { background: var(--red-dim); }
  .code-line.is-active .ln { color: var(--red); font-weight: 700; }
  .code-line.is-active code { color: #ffb4b4; }
  .code-line code { color: #d7dde8; }
  .muted { color: var(--muted); padding: 1rem; margin: 0; font-size: .9rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-bottom: 1rem; }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 10px;
    padding: 1rem 1.1rem;
  }
  .card.card-full { width: 100%; margin-bottom: 1rem; }
  .card.card-full table th { width: 12rem; }
  .card.previous { margin-bottom: 1rem; }
  .card h2 {
    margin: 0 0 .75rem; font-size: .75rem; text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); font-weight: 600;
  }
  .previous-msg { margin: 0 0 .75rem; color: var(--fg); }
  .previous-stack {
    margin: 0; padding: .75rem; background: var(--bg2); border-radius: 8px;
    font-family: var(--mono); font-size: .75rem; color: var(--muted);
    white-space: pre-wrap; overflow-x: auto;
  }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th {
    text-align: left; vertical-align: top; color: var(--muted);
    font-weight: 500; padding: .4rem .5rem .4rem 0; width: 8rem;
    font-family: var(--mono); font-size: .75rem;
  }
  td { padding: .35rem 0; vertical-align: top; }
  td pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: var(--mono); font-size: .78rem; color: var(--fg);
  }
  footer.meta {
    margin-top: 1.25rem; color: var(--muted); font-size: .8rem;
    display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  }
  footer.meta strong { color: var(--fg); }
  .brand {
    margin-top: 2.5rem;
    padding: 1.5rem 0 0.5rem;
    border-top: 1px dashed rgba(255,255,255,.09);
    user-select: none;
  }
  .brand-mark {
    position: relative;
    display: grid;
    place-items: center;
    min-height: clamp(4.5rem, 14vw, 9rem);
    cursor: default;
  }
  .brand-base,
  .brand-glow {
    font-family: var(--mono);
    font-size: clamp(2.75rem, 11vw, 6.5rem);
    font-weight: 800;
    letter-spacing: 0.18em;
    line-height: 1;
    text-transform: uppercase;
    text-align: center;
    margin: 0;
    padding-left: 0.18em;
  }
  .brand-base {
    color: rgba(238,241,246,.12);
  }
  .brand-glow {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: rgba(238,241,246,.92);
    pointer-events: none;
    -webkit-mask-image: radial-gradient(circle at 50% 50%, #000 0%, transparent 120px);
    mask-image: radial-gradient(circle at 50% 50%, #000 0%, transparent 120px);
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="badge">${status} · exception</div>
    <div class="class">${escapeHtml(className)}</div>
    <h1>${escapeHtml(message)}</h1>
    ${topLoc ? `<div class="top-file">${escapeHtml(topLoc)}</div>` : ""}
    ${
      editorSnippet
        ? `<div class="hero-code">${codeBlock(editorSnippet, editor!.line)}</div>`
        : ""
    }
    <h2 class="section-title">Stack trace</h2>
    <div class="frames">
      ${frameHtml || `<p class="muted">No stack frames</p>`}
    </div>
    ${previousHtml}
    <div class="grid">
      ${kvTable("Request", requestRows)}
      ${kvTable("Application", appRows)}
      ${kvTable("Query", queryRows)}
    </div>
    ${kvTable("Headers", headerRows, { fullWidth: true })}
    <footer class="meta">
      <span>Rendered by <strong>${escapeHtml(context.appName ?? "Bunyad")}</strong></span>
      <span>${escapeHtml(new Date().toISOString())}</span>
    </footer>
    ${brandMarkHtml()}
  </div>
</body>
</html>`;
}

/** Build a JSON error payload (debug includes stack + exception class). */
export function exceptionJsonPayload(
  error: unknown,
  debug: boolean,
): Record<string, unknown> {
  const err =
    error instanceof Error ? error : new Error(String(error ?? "Error"));
  const isQuery = queryExceptionInfo(error) != null;
  const payload: Record<string, unknown> = {
    message:
      !debug && isQuery
        ? "Server Error"
        : err.message || "Server Error",
  };
  if (error instanceof BunyadError && error.code) {
    payload.code = error.code;
  }
  if (debug) {
    const queryInfo = queryExceptionInfo(error);
    if (queryInfo) {
      payload.sql = queryInfo.sql;
      payload.bindings = queryInfo.bindings;
      if (queryInfo.sqlState) payload.sqlState = queryInfo.sqlState;
    }
    const frames = parseStack(err);
    const editor = pickEditorFrame(frames);
    payload.exception = err.name;
    payload.file = editor?.path;
    payload.line = editor?.line;
    payload.trace = frames.map((f) => ({
      file: f.path,
      line: f.line,
      column: f.column,
      function: f.functionName,
      application: isApplicationFrame(f),
    }));
    const causes = exceptionChain(error).slice(1);
    if (causes.length > 0) {
      payload.previous = causes.map((cause) => ({
        exception: cause.name,
        message: cause.message,
      }));
    }
  }
  return payload;
}

/**
 * Convert any thrown value into an HTTP Response (HTML or JSON).
 * Always returns a Response so Bun never paints its default overlay.
 */
export function renderException(
  error: unknown,
  context: ExceptionContext = {},
): Response {
  const status = statusFromError(error);
  const shouldReport =
    context.shouldReport !== undefined
      ? context.shouldReport
      : status >= 500;
  if (shouldReport) {
    if (context.reportContext && Object.keys(context.reportContext).length > 0) {
      console.error(context.reportContext);
    }
    report(error);
  }

  const debug =
    context.debug ??
    (process.env.APP_DEBUG === "true" ||
      process.env.APP_DEBUG === "1" ||
      (process.env.NODE_ENV !== "production" &&
        process.env.APP_DEBUG !== "false"));

  const extraHeaders =
    error instanceof HttpException ? { ...error.headers } : {};

  const request = context.request;
  if (
    request &&
    shouldReturnJson(request, error, context.shouldRenderJsonWhen)
  ) {
    return new Response(JSON.stringify(exceptionJsonPayload(error, debug)), {
      status,
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    });
  }

  return new Response(
    renderExceptionHtml(error, { ...context, debug }),
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders,
      },
    },
  );
}
