import { encryptCookieValue } from "./cookie-encryption.ts";
import type { Request } from "./request.ts";

export type QueuedCookieOptions = {
  path?: string;
  domain?: string;
  /** Lifetime in seconds. `0` expires the cookie. */
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type QueuedCookie = {
  value: string;
  options: QueuedCookieOptions;
};

/** Keyed by the raw request so Form Request copies share one queue. */
const queues = new WeakMap<globalThis.Request, Map<string, QueuedCookie>>();

/**
 * Queue a cookie for the response to this request. The kernel attaches it
 * (encrypted when cookie encryption applies) after the route runs.
 */
export function queueCookie(
  request: Request,
  name: string,
  value: string,
  options: QueuedCookieOptions = {},
): void {
  let queue = queues.get(request.raw);
  if (!queue) {
    queue = new Map();
    queues.set(request.raw, queue);
  }
  queue.set(name, {
    value,
    options: { path: "/", httpOnly: true, sameSite: "Lax", ...options },
  });
}

/** Queue an expired cookie so the browser drops it. */
export function forgetQueuedCookie(request: Request, name: string): void {
  queueCookie(request, name, "", { maxAge: 0 });
}

/** Whether a cookie is queued for this request. */
export function hasQueuedCookie(request: Request, name: string): boolean {
  return queues.get(request.raw)?.has(name) ?? false;
}

/** Remove and return a queued cookie (callers that attach it themselves). */
export function pullQueuedCookie(
  request: Request,
  name: string,
): QueuedCookie | undefined {
  const queue = queues.get(request.raw);
  const cookie = queue?.get(name);
  queue?.delete(name);
  return cookie;
}

/** Serialize a cookie to a `Set-Cookie` header value. */
export function serializeCookie(
  name: string,
  value: string,
  options: QueuedCookieOptions,
): string {
  const raw = encryptCookieValue(name, value);
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(raw)}`];
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

/** Attach every queued cookie for `request` to `response`. */
export function addQueuedCookies(request: Request, response: Response): Response {
  const queue = queues.get(request.raw);
  if (!queue?.size) return response;
  queues.delete(request.raw);

  const headers = [...queue].map(([name, { value, options }]) =>
    serializeCookie(name, value, options),
  );
  try {
    for (const header of headers) response.headers.append("Set-Cookie", header);
    return response;
  } catch {
    // `Response.redirect()` has immutable headers — copy, then append.
    const copy = new Response(response.body, response);
    for (const header of headers) copy.headers.append("Set-Cookie", header);
    return copy;
  }
}
