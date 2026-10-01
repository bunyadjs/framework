/**
 * Extra helpers that need the full stack (auth, cache, queue, events).
 * Core already installs HTTP / view / routing helpers.
 */
import "@bunyad/core/globals";
import { bcrypt, csrf_token as csrfTokenForRequest } from "@bunyad/auth";
import type { Request, SessionBag } from "@bunyad/http";
import { cache } from "@bunyad/cache";
import { event } from "@bunyad/events";
import { dispatch } from "@bunyad/queue";
import { getUrlContext } from "@bunyad/router";

/** Current-request CSRF token (falls back to URL context request). */
function csrf_token(request?: Request): string {
  const req = request ?? getUrlContext().request;
  if (!req?.session) {
    throw new Error("csrf_token() requires an active request with a session.");
  }
  return csrfTokenForRequest(req);
}

/** The current request (from the URL context). */
function request(): Request {
  return getUrlContext().request!;
}

/**
 * Current session store, one value (`session('status')`), or put values
 * (`session({ key: value })`).
 */
function session(): SessionBag;
function session<T = unknown>(key: string, defaultValue?: T): T;
function session(values: Record<string, unknown>): void;
function session(
  key?: string | Record<string, unknown>,
  defaultValue?: unknown,
): unknown {
  const store = getUrlContext().request!.session!;
  if (key === undefined) return store;
  if (typeof key === "object") {
    for (const [name, value] of Object.entries(key)) store.put(name, value);
    return undefined;
  }
  return store.get(key, defaultValue);
}

export type BunyadFrameworkGlobalHelpers = {
  request: typeof request;
  session: typeof session;
  csrf_token: typeof csrf_token;
  bcrypt: typeof bcrypt;
  event: typeof event;
  dispatch: typeof dispatch;
  cache: typeof cache;
};

let installed = false;

/** Idempotent — safe to call from multiple entrypoints. */
export function installGlobals(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as typeof globalThis &
    Partial<BunyadFrameworkGlobalHelpers>;
  g.request = request;
  g.session = session;
  g.csrf_token = csrf_token;
  g.bcrypt = bcrypt;
  g.event = event;
  g.dispatch = dispatch;
  g.cache = cache;
}

declare global {
  function request(): Request;
  function session(): SessionBag;
  function session<T = unknown>(key: string, defaultValue?: T): T;
  function session(values: Record<string, unknown>): void;
  function csrf_token(request?: Request): string;
  function bcrypt(value: string, cost?: number): Promise<string>;
  function event(instance: object): Promise<object>;
  function dispatch(
    job: import("@bunyad/queue").Job,
  ): import("@bunyad/queue").PendingDispatch;
  function cache(): import("@bunyad/cache").CacheRepository;
}

installGlobals();
