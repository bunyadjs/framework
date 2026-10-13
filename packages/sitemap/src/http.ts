/**
 * `@bunyad/sitemap/http` — responses (T2.4): stream a small sitemap, or serve
 * pre-generated files from a disk with ETag / Last-Modified / 304 and gzip
 * negotiation. Web `Request`/`Response` only; works with `@bunyad/http`.
 */
import type { Filesystem } from "@bunyad/contracts";
import { gzipStream } from "./gzip.ts";
import type { Sitemap } from "./sitemap.ts";

export type CacheOptions = { maxAge?: number; staleWhileRevalidate?: number };

type RequestLike =
  { headers: Headers } | { header(name: string): string | null };

function header(request: RequestLike | undefined, name: string): string | null {
  if (!request) return null;
  if ("header" in request && typeof request.header === "function")
    return request.header(name);
  return (request as { headers: Headers }).headers.get(name);
}

export function acceptsGzip(request?: RequestLike): boolean {
  const value = header(request, "accept-encoding");
  if (!value) return false;
  return value.split(",").some((part) => {
    const [coding, ...params] = part.trim().toLowerCase().split(";");
    if (coding !== "gzip" && coding !== "*") return false;
    const q = params.find((p) => p.trim().startsWith("q="));
    return !q || Number(q.trim().slice(2)) > 0;
  });
}

function baseHeaders(cache: CacheOptions): Headers {
  const h = new Headers();
  h.set("Content-Type", "application/xml; charset=utf-8");
  h.set(
    "Cache-Control",
    `public, max-age=${cache.maxAge ?? 3600}, stale-while-revalidate=${cache.staleWhileRevalidate ?? 86400}`,
  );
  h.set("X-Robots-Tag", "noindex");
  h.set("Vary", "Accept-Encoding");
  return h;
}

function iterableStream(
  source: AsyncIterable<Uint8Array>,
): ReadableStream<Uint8Array> {
  const it = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await it.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await it.return?.(reason);
    },
  });
}

/**
 * spatie `toResponse($request)`: streams one document (first byte before the
 * whole sitemap is encoded). Over the limits it errors mid-stream; generate
 * large sets with `sitemap:generate` and serve them with `serveSitemapFile`.
 */
export function toResponse(
  sitemap: Sitemap,
  request?: RequestLike,
  cache: CacheOptions = {},
): Response {
  const headers = baseHeaders(cache);
  let body = iterableStream(sitemap.stream());
  if (acceptsGzip(request)) {
    body = gzipStream(body);
    headers.set("Content-Encoding", "gzip");
  }
  return new Response(body, { status: 200, headers });
}

const PART_NAME = /^[A-Za-z0-9._-]+\.xml(?:\.gz)?$/;

/**
 * Serve a pre-generated sitemap file from a disk: 404 when absent, ETag +
 * Last-Modified + 304, `.xml.gz` parts as `application/gzip`, plain XML
 * gzipped on the wire when the client accepts it.
 */
export async function serveSitemapFile(
  disk: Filesystem,
  path: string,
  request?: RequestLike & { method?: string },
  cache: CacheOptions = {},
): Promise<Response> {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (
    !PART_NAME.test(name) ||
    path.split("/").some((s) => s === ".." || s === "")
  ) {
    return new Response("Not Found", { status: 404 });
  }
  if (!(await disk.exists(path)))
    return new Response("Not Found", { status: 404 });
  const [size, modified] = await Promise.all([
    disk.size(path),
    disk.lastModified(path),
  ]);
  const etag = `"${size.toString(36)}-${Math.floor(modified).toString(36)}"`;
  const lastModified = new Date(modified * 1000).toUTCString();
  const headers = baseHeaders(cache);
  headers.set("ETag", etag);
  headers.set("Last-Modified", lastModified);
  const gz = name.endsWith(".gz");
  if (gz) {
    headers.set("Content-Type", "application/gzip");
    headers.delete("Vary");
  }
  const inm = header(request, "if-none-match");
  const ims = header(request, "if-modified-since");
  const notModified = inm
    ? inm.split(",").some((t) => t.trim() === etag || t.trim() === "*")
    : ims !== null && Date.parse(ims) >= Math.floor(modified) * 1000;
  if (notModified) return new Response(null, { status: 304, headers });
  const method = (request as { method?: string } | undefined)?.method;
  if (method === "HEAD") {
    headers.set("Content-Length", String(size));
    return new Response(null, { status: 200, headers });
  }
  let body: ReadableStream<Uint8Array> = await disk.readStream(path);
  if (!gz && acceptsGzip(request)) {
    body = gzipStream(body);
    headers.set("Content-Encoding", "gzip");
  } else {
    headers.set("Content-Length", String(size));
  }
  return new Response(body, { status: 200, headers });
}
