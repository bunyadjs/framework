import { createHash } from "node:crypto";
import type { Request } from "./request.ts";
import type { Next } from "./pipeline.ts";
import { aliasMiddleware, taggedMiddleware } from "./middleware-alias.ts";
import { withHeaders } from "./response-headers.ts";

export type CacheHeaderOptions = {
  public?: boolean;
  private?: boolean;
  max_age?: number;
  s_maxage?: number;
  must_revalidate?: boolean;
  proxy_revalidate?: boolean;
  no_cache?: boolean;
  no_store?: boolean;
  no_transform?: boolean;
  immutable?: boolean;
  stale_while_revalidate?: number;
  stale_if_error?: number;
  /** Send an `ETag` made from the body, and answer `304` when the request already has it. */
  etag?: boolean;
};

const NUMBER_OPTIONS = new Set([
  "max_age",
  "s_maxage",
  "stale_while_revalidate",
  "stale_if_error",
]);
const FLAG_OPTIONS = new Set([
  "public",
  "private",
  "must_revalidate",
  "proxy_revalidate",
  "no_cache",
  "no_store",
  "no_transform",
  "immutable",
  "etag",
]);

/** `public;max_age=300;etag` becomes `{ public: true, max_age: 300, etag: true }`. */
export function parseCacheHeaderOptions(text: string): CacheHeaderOptions {
  const options: Record<string, number | boolean> = {};
  for (const part of text.split(";")) {
    const [rawName, rawValue] = part.split("=");
    const name = (rawName ?? "").trim();
    if (!name) continue;
    if (NUMBER_OPTIONS.has(name)) {
      const value = Number(rawValue);
      if (!Number.isFinite(value) || value < 0)
        throw new Error(`cache.headers: [${name}] needs a number.`);
      options[name] = Math.trunc(value);
    } else if (FLAG_OPTIONS.has(name)) {
      options[name] = true;
    } else {
      throw new Error(`cache.headers: unknown option [${name}].`);
    }
  }
  return options as CacheHeaderOptions;
}

/** The `Cache-Control` value, directives in alphabetical order. */
function cacheControl(options: CacheHeaderOptions): string {
  const directives: string[] = [];
  if (options.immutable) directives.push("immutable");
  if (options.max_age !== undefined)
    directives.push(`max-age=${options.max_age}`);
  if (options.must_revalidate) directives.push("must-revalidate");
  if (options.no_cache) directives.push("no-cache");
  if (options.no_store) directives.push("no-store");
  if (options.no_transform) directives.push("no-transform");
  if (options.private) directives.push("private");
  if (options.proxy_revalidate) directives.push("proxy-revalidate");
  if (options.public && !options.private) directives.push("public");
  if (options.s_maxage !== undefined)
    directives.push(`s-maxage=${options.s_maxage}`);
  if (options.stale_if_error !== undefined)
    directives.push(`stale-if-error=${options.stale_if_error}`);
  if (options.stale_while_revalidate !== undefined) {
    directives.push(`stale-while-revalidate=${options.stale_while_revalidate}`);
  }
  return directives.join(", ");
}

/**
 * `cache.headers:public;max_age=300;etag` or `cache.headers:no_store`: set the cache headers on a
 * response. Only GET and HEAD responses with a body are touched.
 */
export function cacheHeaders(options: CacheHeaderOptions | string = {}) {
  const resolved =
    typeof options === "string" ? parseCacheHeaderOptions(options) : options;
  const value = cacheControl(resolved);
  return taggedMiddleware("cache.headers", {
    async handle(request: Request, next: Next): Promise<Response> {
      const response = await next();
      const method = request.method.toUpperCase();
      if ((method !== "GET" && method !== "HEAD") || response.body === null)
        return response;

      let etag: string | undefined;
      if (resolved.etag) {
        const body = await response.clone().arrayBuffer();
        etag = `"${createHash("md5").update(new Uint8Array(body)).digest("hex")}"`;
        const sent = request.header("if-none-match");
        if (
          sent &&
          sent.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag)
        ) {
          const headers = new Headers(response.headers);
          if (value) headers.set("Cache-Control", value);
          headers.set("ETag", etag);
          headers.delete("Content-Length");
          headers.delete("Content-Type");
          return new Response(null, { status: 304, headers });
        }
      }
      return withHeaders(response, (headers) => {
        if (value) headers.set("Cache-Control", value);
        if (etag) headers.set("ETag", etag);
      });
    },
  });
}

aliasMiddleware("cache.headers", (...params: string[]) =>
  cacheHeaders(params.join(",")),
);
