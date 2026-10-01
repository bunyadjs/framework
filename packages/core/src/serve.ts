import type { Server } from "bun";
import { bindRemoteAddress } from "@bunyad/http";
import { join } from "node:path";
import type { Application } from "./application.ts";
import { createFetchHandler, pathnameOf } from "./kernel.ts";
import {
  createDevReloadHandler,
  defaultRefreshRoots,
  injectReloadScript,
  isHtmlResponse,
} from "./dev-reload.ts";
import { isBunEmbeddedPath } from "./paths.ts";
import { installShutdownHandlers, onShutdown } from "./shutdown.ts";

/** String key — survives `bun --hot` (same as `globalThis` itself). */
const HOT_SERVE_KEY = "__bunyad_core_serve__";

type HotServeState = {
  server: Server<undefined>;
  reload?: ReturnType<typeof createDevReloadHandler>;
  port: number;
  hostname: string;
};

type GlobalWithHotServe = typeof globalThis & {
  [HOT_SERVE_KEY]?: HotServeState;
};

function hotState(): HotServeState | undefined {
  return (globalThis as GlobalWithHotServe)[HOT_SERVE_KEY];
}

function setHotState(state: HotServeState | undefined): void {
  const g = globalThis as GlobalWithHotServe;
  if (state) g[HOT_SERVE_KEY] = state;
  else delete g[HOT_SERVE_KEY];
}

function stopHotServe(prev: HotServeState): void {
  try {
    prev.reload?.stop();
  } catch {
    // ignore
  }
  try {
    prev.server.stop(true);
  } catch {
    // ignore — already stopped
  }
  setHotState(undefined);
}

export type ServeDevelopment =
  | boolean
  | {
      /** Bun client HMR (HTML/JS imports). Default true in development. */
      hmr?: boolean;
      /** Echo browser console to the terminal. */
      console?: boolean;
    };

export type ServeFetch = (
  request: Request,
  server: Server<undefined>,
  next: (request: Request) => Response | Promise<Response>,
) => Response | Promise<Response>;

export type ServeOptions = {
  port?: number;
  hostname?: string;
  /**
   * Bun `development` mode. Defaults to on when `BUNYAD_DEV=1` or
   * `NODE_ENV` is not `production`.
   */
  development?: ServeDevelopment;
  /**
   * Watch view/route/app files and full-reload the browser.
   * `true` (default in dev) uses standard roots; pass paths to customize;
   * `false` disables.
   */
  refresh?: boolean | string[];
  /**
   * Enable SO_REUSEPORT so multiple processes can share one port (cluster).
   * Also set via `BUNYAD_REUSE_PORT=1` (used by `bunyad workers --http=N`).
   * Most effective on Linux.
   */
  reusePort?: boolean;
  /** Max incoming body size in bytes (`Bun.serve` `maxRequestBodySize`). */
  maxRequestBodySize?: number;
  /** Wrap public-file + kernel fetch (CORS, SPA fallback, etc.). */
  fetch?: ServeFetch;
};

function resolveDevelopment(
  option: ServeDevelopment | undefined,
): false | { hmr: boolean; console: boolean } {
  const compiled = isBunEmbeddedPath(import.meta.dir);
  const envDev =
    process.env.BUNYAD_DEV === "1" ||
    process.env.BUNYAD_HOT === "1" ||
    (!compiled &&
      process.env.NODE_ENV !== "production" &&
      process.env.NODE_ENV !== "test");

  if (option === false) return false;
  if (option === undefined && !envDev) return false;

  if (typeof option === "object") {
    return {
      hmr: option.hmr ?? true,
      console: option.console ?? true,
    };
  }
  // option === true or defaulted via env
  return { hmr: true, console: true };
}

/** Serve files from `{basePath}/public` (and embedded `public/` in binaries). */
function tryPublicFile(
  basePath: string,
  pathname: string,
): Response | null | Promise<Response | null> {
  if (pathname === "/" || pathname.includes("\0") || pathname.includes("..")) {
    return null;
  }
  // Route paths rarely look like static assets — skip disk I/O when there is
  // no file extension in the final segment (e.g. `/users`, `/hello/world`).
  const slash = pathname.lastIndexOf("/");
  const base = slash === -1 ? pathname : pathname.slice(slash + 1);
  if (!base.includes(".")) return null;

  return tryPublicFileAsync(basePath, pathname);
}

async function tryPublicFileAsync(
  basePath: string,
  pathname: string,
): Promise<Response | null> {
  const relative = pathname.replace(/^\/+/, "");
  if (!relative) return null;

  const roots: string[] = [];
  // Compiled binaries embed `public/` under import.meta.dir via `--asset`.
  if (isBunEmbeddedPath(import.meta.dir)) {
    roots.push(join(import.meta.dir, "public"));
  }
  roots.push(join(basePath, "public"));

  for (const publicRoot of roots) {
    const filePath = join(publicRoot, relative);
    if (!filePath.startsWith(publicRoot)) continue;
    const file = Bun.file(filePath);
    if (!(await file.exists())) continue;
    return new Response(file);
  }
  return null;
}

function servePublicThenApp(
  baseFetch: ReturnType<typeof createFetchHandler>,
  basePath: string,
  request: Request,
  path: string,
): Response | Promise<Response> {
  if (path.includes(".")) {
    const slash = path.lastIndexOf("/");
    const base = slash === -1 ? path : path.slice(slash + 1);
    if (base.includes(".")) {
      const asset = tryPublicFile(basePath, path);
      if (asset instanceof Promise) {
        return asset.then((file) => file ?? baseFetch(request, path));
      }
      if (asset) return asset;
    }
  }
  return baseFetch(request, path);
}

function clientAddress(
  request: Request,
  server: Server<undefined>,
): string | undefined {
  return server.requestIP(request)?.address;
}

function buildFetch(
  app: Application,
  reload: ReturnType<typeof createDevReloadHandler> | undefined,
  around?: ServeFetch,
): (
  request: Request,
  server: Server<undefined>,
) => Response | Promise<Response> {
  const baseFetch = createFetchHandler(app);
  const basePath = app.basePath();

  const handle = (
    request: Request,
    server: Server<undefined>,
  ): Response | Promise<Response> => {
    if (!reload) {
      return servePublicThenApp(
        baseFetch,
        basePath,
        request,
        pathnameOf(request.url),
      );
    }
    const path = pathnameOf(request.url);
    const early = reload.match(path, request, server);
    if (early) return early;
    const response = servePublicThenApp(baseFetch, basePath, request, path);
    return completeFetch(response, reload);
  };

  // Capture peer IP from the Bun connection Request; re-bind onto any Request
  // a fetch wrapper passes to `next` (clones may not retain requestIP lookup).
  return (request, server) => {
    const address = clientAddress(request, server);
    bindRemoteAddress(request, address);

    if (!around) {
      return handle(request, server);
    }

    return around(request, server, (req) => {
      bindRemoteAddress(req, address ?? clientAddress(req, server));
      return handle(req, server);
    });
  };
}

function completeFetch(
  response: Response | Promise<Response>,
  reload: ReturnType<typeof createDevReloadHandler> | undefined,
): Response | Promise<Response> {
  if (!reload) return response;
  if (response instanceof Promise) {
    return response.then((res) =>
      isHtmlResponse(res) ? injectReloadScript(res) : res,
    );
  }
  return isHtmlResponse(response) ? injectReloadScript(response) : response;
}

function logListening(hostname: string, port: number | string): void {
  const host =
    hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
  const workerId = process.env.BUNYAD_WORKER_ID;
  console.log("");
  console.log(
    `  INFO  Server running on [http://${host}:${port}]${
      workerId != null ? ` (worker ${workerId})` : ""
    }.`,
  );
  console.log("");
  console.log("  Press Ctrl+C to stop the server");
  console.log("");
}

/**
 * Serve the application with Bun.serve.
 * In development: Bun HMR flags + live HTML morph for `.view` changes.
 * Under `bun --hot`, reuses the existing listener via `server.reload()` (avoids EADDRINUSE).
 */
export function serve(
  app: Application,
  options: ServeOptions = {},
): Server<undefined> {
  const port = options.port ?? Number(app.config.get("app.port", 3000));
  const hostname = options.hostname ?? "0.0.0.0";
  const development = resolveDevelopment(options.development);
  const isDev = development !== false;
  const reusePort = options.reusePort ?? process.env.BUNYAD_REUSE_PORT === "1";

  installShutdownHandlers();

  let reload: ReturnType<typeof createDevReloadHandler> | undefined;
  const refreshEnabled = isDev && options.refresh !== false;
  if (refreshEnabled) {
    const roots = Array.isArray(options.refresh)
      ? options.refresh
      : defaultRefreshRoots();
    reload = createDevReloadHandler({ roots });
  }

  const fetch = buildFetch(app, reload, options.fetch);
  const prev = hotState();
  const serveOptions = {
    fetch,
    idleTimeout: 0 as const,
    ...(development ? { development } : {}),
    ...(options.maxRequestBodySize != null
      ? { maxRequestBodySize: options.maxRequestBodySize }
      : {}),
  };

  // Soft-reload: keep the same socket; swap handlers only.
  if (prev && prev.port === port && prev.hostname === hostname) {
    try {
      // Keep SSE clients connected so the browser still receives reloads.
      prev.reload?.stop(false);
    } catch {
      // ignore
    }
    prev.reload = reload;
    prev.server.reload(serveOptions);
    return prev.server;
  }

  if (prev) stopHotServe(prev);

  const server = Bun.serve({
    port,
    hostname,
    ...serveOptions,
    ...(reusePort ? { reusePort: true } : {}),
  });

  setHotState({ server, reload, port, hostname });

  const originalStop = server.stop.bind(server);
  server.stop = ((closeActive?: boolean) => {
    const current = hotState();
    if (current?.server === server) {
      try {
        current.reload?.stop();
      } catch {
        // ignore
      }
      setHotState(undefined);
    }
    return originalStop(closeActive);
  }) as typeof server.stop;

  onShutdown(() => {
    try {
      server.stop(true);
    } catch {
      // already stopped
    }
  });

  logListening(hostname, server.port ?? port);
  return server;
}
