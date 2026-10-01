import { existsSync, watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "bun";

export type DevReloadMode = "morph" | "full";

const RELOAD_CLIENT = `(() => {
  let es = null;
  let delay = 500;
  let sawOpen = false;
  let reloadOnReconnect = false;
  let morphing = false;
  const OVERLAY_ID = "__bunyad-reload-error";

  const hideError = () => document.getElementById(OVERLAY_ID)?.remove();

  const showError = (html) => {
    let el = document.getElementById(OVERLAY_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = OVERLAY_ID;
      el.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#0b0d12;";
      document.documentElement.appendChild(el);
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("title", "Bunyad error");
    frame.style.cssText = "width:100%;height:100%;border:0;background:#0b0d12;";
    el.replaceChildren(frame);
    frame.srcdoc = html;
  };

  const morphDocument = async () => {
    if (morphing) return;
    morphing = true;
    try {
      const res = await fetch(location.href, {
        cache: "no-store",
        headers: { Accept: "text/html", "X-Bunyad-Reload": "1" },
      });
      const html = await res.text();
      if (!res.ok) {
        showError(html);
        return;
      }
      hideError();
      const next = new DOMParser().parseFromString(html, "text/html");
      document.title = next.title;
      const imported = document.importNode(next.body, true);
      imported.querySelectorAll("script").forEach((s) => s.remove());
      const x = window.scrollX;
      const y = window.scrollY;
      const focused = document.activeElement;
      const focusId = focused && focused.id ? focused.id : null;
      document.body.replaceWith(imported);
      if (focusId) document.getElementById(focusId)?.focus();
      window.scrollTo(x, y);
      document.dispatchEvent(new Event("bunyad:morph"));
    } catch {
      location.reload();
    } finally {
      morphing = false;
    }
  };

  const onReload = (ev) => {
    let mode = "full";
    try {
      const data = JSON.parse(ev.data);
      if (data && data.mode) mode = data.mode;
    } catch {}
    if (mode === "morph") {
      morphDocument();
      return;
    }
    location.reload();
  };

  const connect = () => {
    es = new EventSource("/__bunyad/reload");
    es.addEventListener("reload", onReload);
    es.onerror = () => {
      if (sawOpen) reloadOnReconnect = true;
      try { es?.close(); } catch {}
      es = null;
      delay = Math.min(delay * 1.5, 5000);
      setTimeout(connect, delay);
    };
    es.onopen = () => {
      delay = 500;
      // Server process restarted (e.g. bun --watch) — refresh once we're back.
      if (reloadOnReconnect) {
        location.reload();
        return;
      }
      sawOpen = true;
    };
  };
  window.addEventListener("pagehide", () => {
    try { es?.close(); } catch {}
    es = null;
  });
  connect();
})();
`;

type SseClient = {
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
};

const CLIENTS_KEY = "__bunyad_dev_reload_clients__";

type GlobalWithClients = typeof globalThis & {
  [CLIENTS_KEY]?: Set<SseClient>;
};

/** Survives `bun --hot` module re-evaluation (plain module Sets do not). */
function sseClients(): Set<SseClient> {
  const g = globalThis as GlobalWithClients;
  return (g[CLIENTS_KEY] ??= new Set());
}

const enc = new TextEncoder();

/** Vite-style: `5:19:23 AM [bunyad] html update resources/views/welcome.view` */
export function formatReloadLog(
  relativePath: string,
  mode: DevReloadMode = "full",
): string {
  const time = new Date().toLocaleTimeString("en-US", { hour12: true });
  const action = mode === "morph" ? "html update" : "page reload";
  return `${time} \x1b[32m[bunyad]\x1b[0m ${action} ${relativePath}`;
}

export function reloadModeForFiles(files: string[]): DevReloadMode {
  if (files.length === 0) return "full";
  const allViews = files.every((file) =>
    file.replaceAll("\\", "/").endsWith(".view"),
  );
  return allViews ? "morph" : "full";
}

function toRelative(cwd: string, absolute: string): string {
  const normalized = absolute.replaceAll("\\", "/");
  const root = cwd.replaceAll("\\", "/").replace(/\/$/, "");
  if (normalized.startsWith(`${root}/`)) {
    return normalized.slice(root.length + 1);
  }
  return normalized;
}

function safeEnqueue(
  client: SseClient,
  payload: Uint8Array,
): void {
  const clients = sseClients();
  if (client.closed) return;
  try {
    // desiredSize === null means the controller is closed/errored.
    if (client.controller.desiredSize === null) {
      client.closed = true;
      clients.delete(client);
      return;
    }
    client.controller.enqueue(payload);
  } catch {
    client.closed = true;
    clients.delete(client);
  }
}

function broadcastReload(mode: DevReloadMode = "full"): void {
  const payload = enc.encode(
    `event: reload\ndata: ${JSON.stringify({ mode })}\n\n`,
  );
  for (const client of [...sseClients()]) {
    safeEnqueue(client, payload);
  }
}

/** Trigger a browser full-reload (used by the playground after frontend builds). */
export async function requestDevReload(label = "public/build"): Promise<void> {
  await clearViewCache();
  broadcastReload("full");
  console.log(formatReloadLog(label, "full"));
}

/** Clear view compile cache when `@bunyad/view` is installed. */
async function clearViewCache(): Promise<void> {
  try {
    const mod = await import("@bunyad/view");
    mod.getViewFactory().clearCache();
  } catch {
    // factory not set / package not present
  }
}

function shouldIgnoreWatchPath(relativePath: string): boolean {
  const p = relativePath.replaceAll("\\", "/");
  if (p.endsWith(".map")) return true;
  if (p.includes("/.") || p.startsWith(".")) return true;
  if (p.endsWith("~") || p.endsWith(".swp")) return true;
  return false;
}

/**
 * SSE endpoint + client script for live HTML updates when watched files change.
 * `.view` edits morph the current document; other files trigger a full reload.
 */
export function createDevReloadHandler(options: {
  roots: string[];
}): {
  match: (
    pathname: string,
    request?: Request,
    server?: Server<undefined>,
  ) => Response | null;
  /** Stop watchers; pass `false` to keep SSE clients (soft-reload). */
  stop: (closeClients?: boolean) => void;
} {
  const watchers: FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const pending = new Set<string>();
  let lastLogged: string | undefined;
  let lastLoggedCount = 0;
  const cwd = process.cwd();

  const schedule = (changedPath?: string) => {
    if (changedPath) {
      if (shouldIgnoreWatchPath(changedPath)) return;
      pending.add(changedPath);
    }
    clearTimeout(timer);
    // Slightly longer debounce so `public/build` settles (js + css writes).
    timer = setTimeout(() => {
      void (async () => {
        const files = [...pending];
        pending.clear();
        const mode = reloadModeForFiles(files);

        // Clear before telling the browser to reload — otherwise the next
        // request can still hit a stale in-memory renderer.
        await clearViewCache();
        broadcastReload(mode);

        const label =
          files.length === 0
            ? "(unknown)"
            : files.length === 1
              ? files[0]!
              : `${files[0]!} (+${files.length - 1} more)`;

        if (label === lastLogged) {
          lastLoggedCount += 1;
          console.log(`${formatReloadLog(label, mode)} (x${lastLoggedCount})`);
        } else {
          lastLogged = label;
          lastLoggedCount = 1;
          console.log(formatReloadLog(label, mode));
        }
      })().catch(() => {
        // Never let reload scheduling crash the server process.
      });
    }, 80);
  };

  for (const root of options.roots) {
    if (!existsSync(root)) continue;
    try {
      const w = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) {
          schedule(toRelative(cwd, root));
          return;
        }
        const absolute = resolve(root, filename.toString());
        schedule(toRelative(cwd, absolute));
      });
      watchers.push(w);
    } catch {
      // unsupported platform / path
    }
  }

  // Keep SSE clients from looking idle to intermediaries.
  ping = setInterval(() => {
    const comment = enc.encode(`: ping\n\n`);
    for (const client of [...sseClients()]) {
      safeEnqueue(client, comment);
    }
  }, 15_000);

  return {
    match(
      pathname: string,
      request?: Request,
      server?: Server<undefined>,
    ): Response | null {
      if (pathname === "/__bunyad/reload.js") {
        return new Response(RELOAD_CLIENT, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
      if (pathname === "/__bunyad/reload") {
        // Parent `bun run dev` POSTs here after a frontend rebuild.
        if (request?.method === "POST") {
          void requestDevReload("public/build");
          return new Response("ok", {
            headers: { "Cache-Control": "no-store" },
          });
        }
        // Quiet SSE streams count as idle; disable the per-request timeout.
        if (request && server) {
          server.timeout(request, 0);
        }
        let client: SseClient | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            client = { controller, closed: false };
            sseClients().add(client);
            safeEnqueue(client, enc.encode(`: connected\n\n`));
          },
          cancel() {
            if (client) {
              client.closed = true;
              sseClients().delete(client);
            }
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }
      return null;
    },
    stop(closeClients = true) {
      clearTimeout(timer);
      clearInterval(ping);
      for (const w of watchers) w.close();
      if (!closeClients) return;
      const clients = sseClients();
      for (const client of clients) {
        client.closed = true;
        try {
          client.controller.close();
        } catch {
          // ignore — already cancelled by the browser
        }
      }
      clients.clear();
    },
  };
}

/**
 * Default roots to watch for browser live reload.
 *
 * Watch `public/build` (not `resources/js`) so Inertia/frontend edits reload
 * only after `bun run` rebuild finishes — avoids racing a half-written bundle
 * and AbortError noise from cancelling SSE mid-rebuild.
 */
export function defaultRefreshRoots(cwd = process.cwd()): string[] {
  return [
    resolve(cwd, "resources/views"),
    resolve(cwd, "public/build"),
    resolve(cwd, "routes"),
    resolve(cwd, "app"),
  ];
}

/**
 * Inject live-reload script into HTML responses.
 * Buffers the body so a client abort cannot throw through HTMLRewriter streams.
 */
export async function injectReloadScript(
  response: Response,
): Promise<Response> {
  try {
    const html = await response.text();
    const tag = `<script src="/__bunyad/reload.js" defer></script>`;
    const next = html.includes("</body>")
      ? html.replace(/<\/body>/i, `${tag}</body>`)
      : `${html}${tag}`;
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(next, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    // Client navigated away / aborted while we were injecting — ignore.
    if (
      error instanceof Error &&
      (error.name === "AbortError" ||
        String((error as { code?: string }).code).includes("STREAM"))
    ) {
      return response;
    }
    throw error;
  }
}

export function isHtmlResponse(response: Response): boolean {
  const type = response.headers.get("content-type") ?? "";
  return type.includes("text/html");
}
