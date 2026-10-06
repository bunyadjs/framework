import type { Next, Request } from "@bunyad/http";
import { RequestContext, runWithContext } from "./context.ts";
import { toExceptionRecord } from "./debugbar.ts";
import { buildSnapshot } from "./snapshot.ts";
import type { ResolvedDebugbarOptions, Snapshot } from "./types.ts";
import { renderBar, renderHistoryPage } from "./ui.ts";

const NO_STORE = { "Cache-Control": "no-store" };

function pathOf(request: Request): string {
  try {
    return new URL(request.url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function isHtml(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("text/html");
}

/** Rebuild a response with a new body, keeping status and headers (incl. repeated Set-Cookie). */
function withBody(response: Response, body: ConstructorParameters<typeof Response>[0], extra: Record<string, string> = {}): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function setHeader(response: Response, name: string, value: string): Response {
  try {
    response.headers.set(name, value);
    return response;
  } catch {
    // Immutable headers (e.g. Response.redirect) — rebuild.
    return withBody(response, response.body, { [name]: value });
  }
}

/**
 * Global middleware: records a request, retains its snapshot, tags the response with
 * `X-Debugbar-Id`, injects the bar into HTML, and serves the history endpoints.
 */
export class DebugbarMiddleware {
  constructor(private readonly options: ResolvedDebugbarOptions) {}

  async handle(request: Request, next: Next): Promise<Response> {
    const path = pathOf(request);
    const { path: base } = this.options;

    if (path === base || path.startsWith(`${base}/`)) {
      return await this.serve(path.slice(base.length).replace(/^\/+/, ""));
    }
    if (this.options.except.some((prefix) => path.startsWith(prefix))) {
      return next();
    }

    const context = new RequestContext(request, this.options.maxRecords);
    let response: Response;
    try {
      response = await runWithContext(context, () => Promise.resolve(next()));
    } catch (error) {
      context.failed = true;
      context.exceptions.push(toExceptionRecord(error, context.now()));
      await this.save(await buildSnapshot(context, this.options));
      throw error;
    }

    context.response = response;
    const snapshot = await buildSnapshot(context, this.options);
    await this.save(snapshot);

    response = setHeader(response, "X-Debugbar-Id", snapshot.id);
    return this.options.inject ? await this.inject(response, snapshot) : response;
  }

  /** A failing store must never fail the request being debugged. */
  private async save(snapshot: Snapshot): Promise<void> {
    try {
      await this.options.store.put(snapshot);
    } catch {
      // Dev tooling only; the bar still shows this request from the injected data.
    }
  }

  private async inject(response: Response, snapshot: Snapshot): Promise<Response> {
    const redirect = response.status >= 300 && response.status < 400;
    if (redirect || response.body === null || !isHtml(response)) return response;
    if (response.headers.has("content-disposition")) return response;

    const html = await response.text();
    const at = html.lastIndexOf("</body>");
    if (at === -1) return withBody(response, html);

    const bar = renderBar(snapshot, this.options.path);
    return withBody(response, html.slice(0, at) + bar + html.slice(at));
  }

  private async serve(rest: string): Promise<Response> {
    const { store, path } = this.options;
    if (rest === "") {
      return new Response(renderHistoryPage(await store.list(), path), {
        headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE },
      });
    }
    const snapshot = rest === "latest" ? (await store.list(1))[0] : await store.get(rest);
    if (!snapshot) {
      return Response.json({ message: "Snapshot not found." }, { status: 404, headers: NO_STORE });
    }
    return Response.json(snapshot, { headers: NO_STORE });
  }
}
