import type { RequestContract } from "@bunyad/contracts";
import { Arr, Collection, Fluent, collect } from "@bunyad/common";
import { validate, ValidationException, type Rules } from "@bunyad/validation";
import { UploadedFile } from "./uploaded-file.ts";
import { decryptCookieValue } from "./cookie-encryption.ts";

/** Optional signature checker registered by `@bunyad/router`. */
let signatureChecker:
  | ((
      request: Request,
      absolute?: boolean,
      ignore?: string[],
    ) => boolean)
  | undefined;

export function setSignatureChecker(
  checker:
    | ((
        request: Request,
        absolute?: boolean,
        ignore?: string[],
      ) => boolean)
    | undefined,
): void {
  signatureChecker = checker;
}

/** Parse `?a=1&b=2` from a request URL without allocating `new URL()`. */
function parseQueryString(url: string): Record<string, string> {
  const q = url.indexOf("?");
  if (q === -1) return {};
  const hash = url.indexOf("#", q + 1);
  const search = hash === -1 ? url.slice(q + 1) : url.slice(q + 1, hash);
  if (!search) return {};
  const out: Record<string, string> = {};
  new URLSearchParams(search).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function pathnameFromUrl(url: string): string {
  const host = url.indexOf("://");
  const start = url.indexOf("/", host === -1 ? 0 : host + 3);
  if (start === -1) return "/";
  const query = url.indexOf("?", start);
  const hash = url.indexOf("#", start);
  let end = url.length;
  if (query !== -1) end = Math.min(end, query);
  if (hash !== -1) end = Math.min(end, hash);
  const path = url.slice(start, end);
  return path || "/";
}

function hostFromUrl(url: string): string {
  const host = url.indexOf("://");
  const start = host === -1 ? 0 : host + 3;
  const endSlash = url.indexOf("/", start);
  const endQuery = url.indexOf("?", start);
  const endHash = url.indexOf("#", start);
  let end = url.length;
  if (endSlash !== -1) end = Math.min(end, endSlash);
  if (endQuery !== -1) end = Math.min(end, endQuery);
  if (endHash !== -1) end = Math.min(end, endHash);
  return url.slice(start, end);
}

function schemeFromUrl(url: string): string {
  const host = url.indexOf("://");
  return host === -1 ? "http" : url.slice(0, host);
}

/** Minimal session surface used by HTTP (avoids hard dep on @bunyad/session types). */
export type SessionBag = {
  get<T = unknown>(key: string, defaultValue?: T): T;
  put(key: string, value: unknown): void;
  flash(key: string, value: unknown): void;
  has(key: string): boolean;
  forget(key: string): void;
  /** Get and remove (Laravel `Session::pull`). */
  pull?<T = unknown>(key: string, defaultValue?: T): T;
  /** Rotate session id (session fixation protection). */
  regenerate?(destroy?: boolean): boolean;
  /** Flush data and regenerate id (logout). */
  invalidate?(): boolean;
  /** Whether the password was confirmed within `timeout` seconds (`password.confirm` middleware). */
  passwordConfirmed?(timeout?: number): boolean;
  /** Session id (`blockSession` middleware). */
  id?(): string;
};

/**
 * Laravel-like request wrapper over the Fetch Request.
 */

/**
 * Trusted proxy configuration (Laravel TrustProxies).
 * Default: trust none — `X-Forwarded-For` / `X-Real-IP` are ignored unless
 * the connection remote address is in this list (or `*` trusts all).
 */
let trustedProxies: string[] | "*" = [];

/** Configure which proxies may set forwarded client IP headers. Default: none. */
export function setTrustedProxies(proxies: string[] | "*"): void {
  trustedProxies = proxies;
}

export function getTrustedProxies(): string[] | "*" {
  return trustedProxies;
}

/** Weak association of TCP peer address onto a Fetch Request (set by Bun.serve). */
const remoteAddressByRaw = new WeakMap<globalThis.Request, string>();

/**
 * Bind the connection remote address onto a Fetch Request so Bunyad `Request`
 * constructed from it picks it up in the constructor (Laravel-like `ip()`).
 * Called from the serve adapter via `server.requestIP(request)?.address`.
 */
export function bindRemoteAddress(
  raw: globalThis.Request,
  address: string | undefined,
): globalThis.Request {
  if (address != null && address !== "") {
    remoteAddressByRaw.set(raw, address);
  }
  return raw;
}

/** Read a previously bound remote address (tests / adapters). */
export function getBoundRemoteAddress(
  raw: globalThis.Request,
): string | undefined {
  return remoteAddressByRaw.get(raw);
}

function ipMatches(ip: string, pattern: string): boolean {
  if (pattern === "*" || pattern === ip) return true;
  // Simple CIDR / prefix: "10.0.0." matches 10.0.0.x; "10.0.0.0/8" → prefix 10.
  if (pattern.endsWith(".")) return ip.startsWith(pattern);
  const cidr = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(pattern);
  if (cidr) {
    const [a, b, c, d] = cidr[1]!.split(".").map(Number);
    const [e, f, g, h] = ip.split(".").map(Number);
    if ([a, b, c, d, e, f, g, h].some((n) => n === undefined || Number.isNaN(n))) {
      return false;
    }
    const mask = Number(cidr[2]);
    const base = ((a! << 24) | (b! << 16) | (c! << 8) | d!) >>> 0;
    const addr = ((e! << 24) | (f! << 16) | (g! << 8) | h!) >>> 0;
    const maskBits = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;
    return (base & maskBits) === (addr & maskBits);
  }
  return false;
}

function isTrustedProxy(remoteAddress: string): boolean {
  if (trustedProxies === "*") return true;
  return trustedProxies.some((p) => ipMatches(remoteAddress, p));
}

export class Request implements RequestContract {
  readonly raw: globalThis.Request;
  method: string;
  readonly url: string;
  session?: SessionBag;
  user?: unknown;
  /** Name of the matched route (`Route.get(...).name("dashboard")`), set by the kernel. */
  routeName?: string;
  /** Personal access token id when authenticated via TokenGuard. */
  accessTokenId?: number;
  #params: Record<string, string>;
  #models: Record<string, unknown> | undefined;
  #query: Record<string, string> | undefined;
  #json: Record<string, unknown> | undefined;
  #files: Record<string, UploadedFile | UploadedFile[]> | undefined;
  #jsonLoaded = false;
  /** TCP peer address set by the server (not spoofable headers). */
  #remoteAddress: string | undefined;
  #cachedAcceptHeader: string | null | undefined = undefined;
  #acceptableContentTypes: string[] | undefined;

  constructor(raw: globalThis.Request, params: Record<string, string> = {}) {
    this.raw = raw;
    this.method = raw.method;
    this.url = raw.url;
    this.#params = params;
    const bound = remoteAddressByRaw.get(raw);
    if (bound !== undefined) this.#remoteAddress = bound;
  }

  /** Override the verb after `_method` spoofing (routing / middleware). */
  setMethod(method: string): this {
    this.method = method;
    return this;
  }

  setRouteParams(params: Record<string, string>): void {
    this.#params = params;
  }

  /** All route parameters, or one by name (`request.route("token")`). */
  route(): Record<string, string>;
  route(key: string): string;
  route(key?: string): string | Record<string, string> {
    if (key === undefined) return this.#params;
    return this.#params[key]!;
  }

  /** Resolved route-model binding (`request.model("post")`). */
  model<T = unknown>(key: string): T {
    return this.#models?.[key] as T;
  }

  setModel(key: string, value: unknown): void {
    (this.#models ??= {})[key] = value;
  }

  query(): Record<string, string> {
    if (!this.#query) {
      this.#query = parseQueryString(this.url);
    }
    return this.#query;
  }

  /** Repeated query values (`foo=a&foo=b` or `foo[]=a&foo[]=b`). */
  queryValues(key: string): string[] {
    const q = this.url.indexOf("?");
    if (q === -1) return [];
    const hash = this.url.indexOf("#", q + 1);
    const search =
      hash === -1 ? this.url.slice(q + 1) : this.url.slice(q + 1, hash);
    if (!search) return [];
    const params = new URLSearchParams(search);
    return [...params.getAll(key), ...params.getAll(`${key}[]`)].filter(
      (value) => value !== "",
    );
  }

  async loadJson(): Promise<void> {
    if (this.#jsonLoaded) return;
    this.#jsonLoaded = true;
    const type = this.raw.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const text = await this.raw.text();
      this.#json = text.trim()
        ? (JSON.parse(text) as Record<string, unknown>)
        : {};
      return;
    }
    if (type.includes("application/x-www-form-urlencoded")) {
      const out: Record<string, unknown> = {};
      new URLSearchParams(await this.raw.text()).forEach((value, key) => {
        out[key] = value;
      });
      this.#json = out;
      return;
    }
    if (type.includes("multipart/form-data")) {
      const form = await this.raw.formData();
      const out: Record<string, unknown> = {};
      const files: Record<string, UploadedFile | UploadedFile[]> = {};
      for (const [key, value] of form.entries()) {
        if (value instanceof File) {
          const uploaded = UploadedFile.fromFile(value);
          const existing = files[key];
          if (existing) {
            files[key] = Array.isArray(existing)
              ? [...existing, uploaded]
              : [existing, uploaded];
          } else {
            files[key] = uploaded;
          }
          // Also expose in input bag like Laravel (file objects in all())
          out[key] = files[key];
        } else {
          if (key in out && !isUploadedFileValue(out[key])) {
            const prev = out[key];
            out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
          } else {
            out[key] = value;
          }
        }
      }
      this.#json = out;
      this.#files = files;
      return;
    }
    this.#json = {};
  }

  input(key: string, defaultValue?: unknown): unknown {
    // Match `all()` precedence: route params > body > query.
    // Dot keys use Arr.get (Laravel `data_get` on the merged bag).
    if (key.includes(".")) {
      return Arr.get(this.all(), key, defaultValue);
    }
    if (key in this.#params) return this.#params[key];
    if (this.#json && key in this.#json) return this.#json[key];
    const q = this.query();
    if (key in q) return q[key];
    return defaultValue;
  }

  all(): Record<string, unknown> {
    return { ...this.query(), ...this.#json, ...this.#params };
  }

  /** Laravel `request->only([...])`. */
  only(keys: string[]): Record<string, unknown> {
    const all = this.all();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in all) out[key] = all[key];
    }
    return out;
  }

  /** Laravel `request->except([...])`. */
  except(keys: string[]): Record<string, unknown> {
    const skip = new Set(keys);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.all())) {
      if (!skip.has(key)) out[key] = value;
    }
    return out;
  }

  /** Laravel `request->boolean($key)`. */
  boolean(key: string, defaultValue = false): boolean {
    const value = this.input(key);
    if (value === undefined || value === null || value === "") return defaultValue;
    return (
      value === true ||
      value === 1 ||
      value === "1" ||
      value === "true" ||
      value === "on" ||
      value === "yes"
    );
  }

  /** Laravel `request->filled($key)`. */
  filled(key: string): boolean {
    const value = this.input(key);
    return value !== undefined && value !== null && value !== "";
  }

  /** Laravel `request->has($keys)` — all keys present (not missing). */
  has(...keys: string[] | [string[]]): boolean {
    const list = flattenKeys(keys);
    const bag = this.all();
    return list.every((key) =>
      key.includes(".") ? Arr.has(bag, key) : key in bag,
    );
  }

  /** Laravel `request->hasAny($keys)`. */
  hasAny(...keys: string[] | [string[]]): boolean {
    const list = flattenKeys(keys);
    const bag = this.all();
    return list.some((key) =>
      key.includes(".") ? Arr.has(bag, key) : key in bag,
    );
  }

  /** Laravel `request->missing($key)`. */
  missing(key: string): boolean {
    return !this.has(key);
  }

  /** Laravel `request->integer($key, $default)`. */
  integer(key: string, defaultValue = 0): number {
    const value = this.input(key);
    if (value === undefined || value === null || value === "") return defaultValue;
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : defaultValue;
  }

  /** Laravel `request->float($key, $default)`. */
  float(key: string, defaultValue = 0): number {
    const value = this.input(key);
    if (value === undefined || value === null || value === "") return defaultValue;
    const n = Number.parseFloat(String(value));
    return Number.isFinite(n) ? n : defaultValue;
  }

  /** Laravel `request->string($key, $default)` — returns a plain string. */
  string(key: string, defaultValue = ""): string {
    const value = this.input(key);
    if (value === undefined || value === null) return defaultValue;
    return String(value);
  }

  /** Laravel `request->collect($key?)`. */
  collect(key?: string): Collection<unknown> {
    if (key === undefined) return collect(Object.values(this.all()));
    const value = this.input(key);
    if (Array.isArray(value)) return collect(value);
    if (value && typeof value === "object") {
      return collect(Object.values(value as Record<string, unknown>));
    }
    return collect<unknown>(value === undefined ? [] : [value]);
  }

  /** Merge values into the request input bag (Laravel `request->merge`). */
  merge(input: Record<string, unknown>): this {
    this.#json = { ...(this.#json ?? {}), ...input };
    return this;
  }

  /** Merge only keys that are missing (Laravel `request->mergeIfMissing`). */
  mergeIfMissing(input: Record<string, unknown>): this {
    const bag = this.all();
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (!(key in bag)) next[key] = value;
    }
    return this.merge(next);
  }

  /** Laravel `request->isMethod($method)`. */
  isMethod(method: string): boolean {
    return this.method.toUpperCase() === method.toUpperCase();
  }

  /** Whether the preferred Accept type is JSON (`/json` or `+json`). */
  wantsJson(): boolean {
    const first = this.getAcceptableContentTypes()[0];
    if (!first) return false;
    return first.includes("/json") || first.includes("+json");
  }

  /**
   * Whether the client probably expects a JSON response
   * (AJAX accepting any content type, or preferred Accept is JSON).
   */
  expectsJson(): boolean {
    return (
      (this.ajax() && !this.pjax() && this.acceptsAnyContentType()) ||
      this.wantsJson()
    );
  }

  /** Laravel `request->ajax()`. */
  ajax(): boolean {
    return (this.header("x-requested-with") ?? "").toLowerCase() === "xmlhttprequest";
  }

  /** Pathname without query (Laravel `request->path()`). */
  path(): string {
    const full = pathnameFromUrl(this.url);
    return full === "/" ? "/" : full.replace(/^\//, "");
  }

  /** Full URL including query (Laravel `request->fullUrl()`). */
  fullUrl(): string {
    return this.url;
  }

  /** Host header / URL host (Laravel `request->host()`). */
  host(): string {
    const header = this.header("host");
    if (header) return header;
    return hostFromUrl(this.url);
  }

  /** URL scheme (Laravel `request->getScheme()` / `scheme()`). */
  scheme(): string {
    const remote = this.#remoteAddress ?? "127.0.0.1";
    if (isTrustedProxy(remote)) {
      const forwarded = this.header("x-forwarded-proto");
      if (forwarded) return forwarded.split(",")[0]!.trim();
    }
    return schemeFromUrl(this.url);
  }

  /** Laravel `request->secure()`. */
  secure(): boolean {
    return this.scheme() === "https";
  }

  /** Laravel `request->exists($keys)` — alias of `has`. */
  exists(...keys: string[] | [string[]]): boolean {
    return this.has(...keys);
  }

  /** Laravel `request->anyFilled($keys)`. */
  anyFilled(...keys: string[] | [string[]]): boolean {
    return flattenKeys(keys).some((key) => this.filled(key));
  }

  /** Laravel `request->array($key)` — value as array. */
  array(key?: string): unknown[] {
    if (key === undefined) return Object.values(this.all());
    const value = this.input(key);
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  }

  /** Laravel `request->date($key)` — parse as Date or null. */
  date(key: string, format?: string): Date | null {
    const value = this.input(key);
    if (value === undefined || value === null || value === "") return null;
    if (value instanceof Date) return value;
    const raw = String(value);
    if (format === "U" || format === "unix") {
      const n = Number(raw);
      return Number.isFinite(n) ? new Date(n * 1000) : null;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** Laravel `request->enum($key, Enum)`. */
  enum<T extends Record<string, string | number>>(
    key: string,
    enumType: T,
  ): T[keyof T] | null {
    const value = this.input(key);
    if (value === undefined || value === null || value === "") return null;
    const values = Object.values(enumType) as Array<T[keyof T]>;
    return values.includes(value as T[keyof T]) ? (value as T[keyof T]) : null;
  }

  /** Laravel `request->enums($key, Enum)` for array inputs. */
  enums<T extends Record<string, string | number>>(
    key: string,
    enumType: T,
  ): Array<T[keyof T]> {
    const values = Object.values(enumType) as Array<T[keyof T]>;
    return this.array(key).filter((v): v is T[keyof T] =>
      values.includes(v as T[keyof T]),
    );
  }

  /** Cookie value (Laravel `request->cookie($key)`). */
  cookie(key: string, defaultValue: string | null = null): string | null {
    return this.cookies()[key] ?? defaultValue;
  }

  /** All cookies (decrypted when cookie encryption is enabled). */
  cookies(): Record<string, string> {
    const header = this.header("cookie");
    if (!header) return {};
    const out: Record<string, string> = {};
    for (const part of header.split(";")) {
      const i = part.indexOf("=");
      if (i === -1) continue;
      const name = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();
      let decoded: string;
      try {
        decoded = decodeURIComponent(value);
      } catch {
        decoded = value;
      }
      out[name] = decryptCookieValue(name, decoded);
    }
    return out;
  }

  /** Laravel `request->keys()`. */
  keys(): string[] {
    return Object.keys(this.all());
  }

  /** Replace the entire input bag (Laravel `request->replace`). */
  replace(input: Record<string, unknown>): this {
    this.#json = { ...input };
    return this;
  }

  /** Alias for `input` (Laravel `request->get`). */
  get(key: string, defaultValue?: unknown): unknown {
    return this.input(key, defaultValue);
  }

  /** Laravel `request->json($key?)` — JSON body value. */
  json(key?: string, defaultValue?: unknown): unknown {
    if (key === undefined) return this.#json ?? {};
    if (this.#json && key in this.#json) return this.#json[key];
    return defaultValue;
  }

  /** Laravel `request->toArray()`. */
  toArray(): Record<string, unknown> {
    return this.all();
  }

  /** Laravel `request->accepts($contentTypes)`. */
  accepts(contentTypes: string | string[]): boolean {
    const list = Array.isArray(contentTypes) ? contentTypes : [contentTypes];
    const accept = (this.header("accept") ?? "*/*").toLowerCase();
    if (accept.includes("*/*")) return true;
    return list.some((type) => {
      const t = type.toLowerCase();
      return accept.includes(t) || accept.includes(t.split("/")[1] ?? t);
    });
  }

  acceptsAnyContentType(): boolean {
    const acceptable = this.getAcceptableContentTypes();
    if (acceptable.length === 0) return true;
    const first = acceptable[0];
    return first === "*/*" || first === "*";
  }

  acceptsJson(): boolean {
    return this.accepts(["application/json", "application/javascript", "text/json"]);
  }

  acceptsHtml(): boolean {
    return this.accepts(["text/html", "application/xhtml+xml"]);
  }

  acceptsMarkdown(): boolean {
    return this.accepts(["text/markdown", "text/x-markdown"]);
  }

  /** Laravel `request->prefers($contentTypes)`. */
  prefers(contentTypes: string[]): string | null {
    const accept = (this.header("accept") ?? "").toLowerCase();
    for (const type of contentTypes) {
      if (accept.includes(type.toLowerCase())) return type;
    }
    return contentTypes[0] ?? null;
  }

  isJson(): boolean {
    const type = (this.header("content-type") ?? "").toLowerCase();
    return type.includes("/json") || type.includes("+json");
  }

  /** Alias of `ajax` (Laravel `isXmlHttpRequest`). */
  isXmlHttpRequest(): boolean {
    return this.ajax();
  }

  pjax(): boolean {
    return (this.header("x-pjax") ?? "") !== "";
  }

  prefetch(): boolean {
    return (
      (this.header("purpose") ?? "").toLowerCase() === "prefetch" ||
      (this.header("x-purpose") ?? "").toLowerCase() === "prefetch" ||
      (this.header("x-moz") ?? "").toLowerCase() === "prefetch"
    );
  }

  /** Pathname without leading slash trim issues (Laravel `decodedPath`). */
  decodedPath(): string {
    try {
      return decodeURIComponent(this.path());
    } catch {
      return this.path();
    }
  }

  /**
   * URL without query string (Laravel `request->url()`).
   * Note: the `url` property remains the full Fetch URL (with query).
   */
  urlWithoutQuery(): string {
    const u = new URL(this.url);
    return `${u.origin}${u.pathname}`;
  }

  /** Root URL (Laravel `request->root()`). */
  root(): string {
    return new URL(this.url).origin;
  }

  getQueryString(): string | null {
    const q = new URL(this.url).search;
    return q ? q.slice(1) : null;
  }

  fullUrlWithQuery(query: Record<string, string | number | null | undefined>): string {
    const u = new URL(this.url);
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined) u.searchParams.delete(key);
      else u.searchParams.set(key, String(value));
    }
    return u.toString();
  }

  fullUrlWithoutQuery(keys?: string | string[]): string {
    const u = new URL(this.url);
    if (keys === undefined) {
      u.search = "";
    } else {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) u.searchParams.delete(key);
    }
    return u.toString();
  }

  httpHost(): string {
    return this.host();
  }

  getHost(): string {
    return this.host().split(":")[0]!;
  }

  getPort(): number | null {
    const u = new URL(this.url);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  }

  getSchemeAndHttpHost(): string {
    return `${this.scheme()}://${this.host()}`;
  }

  /** Path segments (Laravel `request->segments()`). */
  segments(): string[] {
    const p = this.path();
    if (p === "/" || p === "") return [];
    return p.replace(/^\//, "").split("/").filter(Boolean);
  }

  segment(index: number, defaultValue: string | null = null): string | null {
    return this.segments()[index - 1] ?? defaultValue;
  }

  /** Laravel `request->is(...patterns)` — path match (`*` wildcards). */
  is(...patterns: string[]): boolean {
    const path = this.path().replace(/^\//, "");
    return patterns.some((pattern) => matchPathPattern(path, pattern.replace(/^\//, "")));
  }

  /** Whether the matched route name fits any pattern (`*` wildcards), e.g. `routeIs("settings.*")`. */
  routeIs(...patterns: string[]): boolean {
    const name = this.routeName;
    if (!name) return false;
    return patterns.some((pattern) => matchPathPattern(name, pattern));
  }

  userAgent(): string | null {
    return this.header("user-agent");
  }

  /**
   * Client IP chain (Laravel `request->ips()`).
   * Only reads `X-Forwarded-For` when the connection remote address is trusted;
   * otherwise returns `[ip()]` so spoofed headers cannot invent a chain.
   */
  ips(): string[] {
    const remote = this.#remoteAddress ?? "127.0.0.1";
    if (isTrustedProxy(remote)) {
      const forwarded = this.header("x-forwarded-for");
      if (forwarded) {
        const chain = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
        if (chain.length) return chain;
      }
    }
    return [this.ip()];
  }

  isMethodSafe(): boolean {
    return ["GET", "HEAD", "OPTIONS", "TRACE"].includes(this.method.toUpperCase());
  }

  isMethodIdempotent(): boolean {
    return (
      this.isMethodSafe() ||
      ["PUT", "DELETE"].includes(this.method.toUpperCase())
    );
  }

  /** Clamp a numeric input (Laravel `request->clamp`). */
  clamp(key: string, min: number, max: number, defaultValue = 0): number {
    const n = this.float(key, defaultValue);
    return Math.min(max, Math.max(min, n));
  }

  /** Run callback when key is filled (Laravel `whenFilled`). */
  whenFilled<T>(
    key: string,
    callback: (value: unknown) => T,
    defaultValue?: T | (() => T),
  ): T | undefined {
    if (this.filled(key)) return callback(this.input(key));
    if (defaultValue === undefined) return undefined;
    return typeof defaultValue === "function"
      ? (defaultValue as () => T)()
      : defaultValue;
  }

  /** Run callback when key exists (Laravel `whenHas`). */
  whenHas<T>(
    key: string,
    callback: (value: unknown) => T,
    defaultValue?: T | (() => T),
  ): T | undefined {
    if (this.has(key)) return callback(this.input(key));
    if (defaultValue === undefined) return undefined;
    return typeof defaultValue === "function"
      ? (defaultValue as () => T)()
      : defaultValue;
  }

  /** Run callback when key is missing (Laravel `whenMissing`). */
  whenMissing<T>(
    key: string,
    callback: () => T,
    defaultValue?: T | (() => T),
  ): T | undefined {
    if (this.missing(key)) return callback();
    if (defaultValue === undefined) return undefined;
    return typeof defaultValue === "function"
      ? (defaultValue as () => T)()
      : defaultValue;
  }

  /** Run callback when input matches an enum value (Laravel `whenEnum`). */
  whenEnum<T extends Record<string, string | number>, R>(
    key: string,
    enumType: T,
    callback: (value: T[keyof T]) => R,
    defaultValue?: R | (() => R),
  ): R | undefined {
    const value = this.enum(key, enumType);
    if (value !== null) return callback(value);
    if (defaultValue === undefined) return undefined;
    return typeof defaultValue === "function"
      ? (defaultValue as () => R)()
      : defaultValue;
  }

  /** Conditional helper (Laravel `when`). */
  when<T>(
    condition: boolean | (() => boolean),
    callback: (request: this) => T,
    defaultValue?: T | ((request: this) => T),
  ): T | this {
    const ok = typeof condition === "function" ? condition() : condition;
    if (ok) return callback(this);
    if (defaultValue === undefined) return this;
    return typeof defaultValue === "function"
      ? (defaultValue as (request: this) => T)(this)
      : defaultValue;
  }

  /** Inverse of `when` (Laravel `unless`). */
  unless<T>(
    condition: boolean | (() => boolean),
    callback: (request: this) => T,
    defaultValue?: T | ((request: this) => T),
  ): T | this {
    const ok = typeof condition === "function" ? condition() : condition;
    return this.when(!ok, callback, defaultValue);
  }

  /** Whether the key is present but empty (Laravel `isNotFilled`). */
  isNotFilled(key: string): boolean {
    return this.has(key) && !this.filled(key);
  }

  /** Whether a header is present. */
  hasHeader(key: string): boolean {
    return this.raw.headers.has(key);
  }

  /** Whether a cookie is present. */
  hasCookie(key: string): boolean {
    return key in this.cookies();
  }

  /** Whether a session bag is attached. */
  hasSession(): boolean {
    return this.session != null;
  }

  /** Session bag (throws when missing). */
  getSession(): SessionBag {
    if (!this.session) {
      throw new Error("Session store is not set on the request.");
    }
    return this.session;
  }

  /** Flash input into the session (Laravel `flash`). */
  flash(): this {
    this.session?.flash("_old_input", this.all());
    return this;
  }

  /** Flash only the given keys (Laravel `flashOnly`). */
  flashOnly(keys: string | string[]): this {
    const list = Array.isArray(keys) ? keys : [keys];
    this.session?.flash("_old_input", this.only(list));
    return this;
  }

  /** Flash all keys except the given ones (Laravel `flashExcept`). */
  flashExcept(keys: string | string[]): this {
    const list = Array.isArray(keys) ? keys : [keys];
    this.session?.flash("_old_input", this.except(list));
    return this;
  }

  /** Previously flashed input (Laravel `old`). */
  old(key?: string, defaultValue: unknown = null): unknown {
    const bag =
      (this.session?.get("_old_input") as Record<string, unknown> | undefined) ??
      {};
    if (key === undefined) return bag;
    return key in bag ? bag[key] : defaultValue;
  }

  /** POST/body input (Laravel `post`). */
  post(key?: string, defaultValue?: unknown): unknown {
    if (key === undefined) return this.#json ?? {};
    return this.input(key, defaultValue);
  }

  /** Server/environment-style bag (Laravel `server`). */
  server(key?: string, defaultValue: unknown = null): unknown {
    const bag: Record<string, unknown> = {
      REQUEST_METHOD: this.method,
      REQUEST_URI: this.uri(),
      HTTP_HOST: this.host(),
      HTTPS: this.secure() ? "on" : "off",
      CONTENT_TYPE: this.getContentType(),
      REMOTE_ADDR: this.ip(),
    };
    if (key === undefined) return bag;
    return key in bag ? bag[key] : defaultValue;
  }

  /** Input data bag (Laravel `data`). */
  data(): Record<string, unknown> {
    return this.all();
  }

  /** Path + query string (Laravel `uri`). */
  uri(): string {
    const u = new URL(this.url);
    return `${u.pathname}${u.search}`;
  }

  /** Scheme and HTTP host (Laravel `schemeAndHttpHost`). */
  schemeAndHttpHost(): string {
    return this.getSchemeAndHttpHost();
  }

  /** Whether the full URL matches a pattern (Laravel `fullUrlIs`). */
  fullUrlIs(...patterns: string[]): boolean {
    const full = this.fullUrl();
    return patterns.some((pattern) => matchPathPattern(full, pattern));
  }

  /** Preferred format from Accept (Laravel `format`). */
  format(defaultFormat = "html"): string {
    const accept = this.header("accept") ?? "";
    if (accept.includes("application/json") || accept.includes("+json")) {
      return "json";
    }
    if (accept.includes("text/markdown") || accept.includes("text/x-markdown")) {
      return "markdown";
    }
    if (accept.includes("application/xml") || accept.includes("text/xml")) {
      return "xml";
    }
    if (accept.includes("text/html")) return "html";
    return defaultFormat;
  }

  /** Parsed Accept content types (cached while the Accept header is unchanged). */
  getAcceptableContentTypes(): string[] {
    const accept = this.header("accept");
    if (this.#cachedAcceptHeader === accept && this.#acceptableContentTypes) {
      return this.#acceptableContentTypes;
    }
    this.#cachedAcceptHeader = accept;
    if (!accept) {
      this.#acceptableContentTypes = ["*/*"];
      return this.#acceptableContentTypes;
    }
    this.#acceptableContentTypes = accept
      .split(",")
      .map((part) => part.split(";")[0]!.trim().toLowerCase())
      .filter(Boolean);
    return this.#acceptableContentTypes;
  }

  /** Whether Accept matches a type (Laravel `matchesType`). */
  matchesType(actual: string, type: string): boolean {
    const a = actual.toLowerCase();
    const t = type.toLowerCase();
    if (a === t || a === "*/*" || t === "*/*") return true;
    const [aType, aSub = "*"] = a.split("/");
    const [tType, tSub = "*"] = t.split("/");
    return (
      (aType === tType || aType === "*" || tType === "*") &&
      (aSub === tSub || aSub === "*" || tSub === "*")
    );
  }

  /** Whether the client prefers Markdown. */
  wantsMarkdown(): boolean {
    return this.acceptsMarkdown() || this.format() === "markdown";
  }

  /** Input as a Fluent bag (Laravel `fluent`). */
  fluent(key?: string): Fluent {
    if (key === undefined) return Fluent.make(this.all());
    const value = this.input(key);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Fluent.make(value as Record<string, unknown>);
    }
    return Fluent.make({});
  }

  /** String input helper (Laravel `str` — returns the string value). */
  str(key: string, defaultValue = ""): string {
    return this.string(key, defaultValue);
  }

  /** Seconds for Retry-After / interval hints (Laravel `interval`). */
  interval(seconds: number): number {
    return Math.max(0, Math.floor(seconds));
  }

  /** This request instance (Laravel `instance`). */
  instance(): this {
    return this;
  }

  /** Dump request data to the console (Laravel `dump`). */
  dump(...keys: string[]): this {
    const payload = keys.length > 0 ? this.only(keys) : this.all();
    console.log(payload);
    return this;
  }

  /** Dump and stop (Laravel `dd`). */
  dd(...keys: string[]): never {
    this.dump(...keys);
    throw new Error("dd()");
  }

  /** Stable fingerprint of method + path + IP (Laravel `fingerprint`). */
  fingerprint(): string {
    return `${this.method}|${this.path()}|${this.ip()}`;
  }

  getContentType(): string | null {
    return this.header("content-type");
  }

  /** Laravel `request->hasFile($key)`. */
  hasFile(key: string): boolean {
    return this.#files != null && key in this.#files;
  }

  /**
   * Laravel `request->file($key)`.
   * Returns a single UploadedFile, an array, or undefined.
   */
  file(key: string): UploadedFile | UploadedFile[] | undefined {
    return this.#files?.[key];
  }

  /**
   * Fluent image pipeline for an upload (`request.image($key)`).
   * Returns `null` when the file is missing or is an array of files.
   */
  async image(key: string): Promise<import("@bunyad/image").PendingImage | null> {
    const file = this.file(key);
    if (!file || Array.isArray(file)) return null;
    const { Image } = await import("@bunyad/image");
    return Image.fromUpload(file);
  }

  /** Laravel `request->allFiles()`. */
  allFiles(): Record<string, UploadedFile | UploadedFile[]> {
    return this.#files ? { ...this.#files } : {};
  }

  header(name: string): string | null {
    return this.raw.headers.get(name);
  }


  /**
   * Set the connection remote address (from Bun.serve `server.requestIP`).
   * Used by `ip()` when deciding whether to trust forwarded headers.
   */
  setRemoteAddress(address: string | undefined): this {
    this.#remoteAddress = address;
    return this;
  }

  /** Connection remote address when known. */
  remoteAddress(): string | undefined {
    return this.#remoteAddress;
  }

  /**
   * Client IP (Laravel-style trusted proxies).
   * Default trusts no proxies — spoofed `X-Forwarded-For` / `X-Real-IP` are ignored.
   * Call `setTrustedProxies([...])` (or `"*"`) so only connections from those
   * addresses may supply forwarded client IPs. Otherwise returns the connection
   * remote address (or `127.0.0.1` when unknown).
   */
  ip(): string {
    const remote = this.#remoteAddress ?? "127.0.0.1";
    if (!isTrustedProxy(remote)) {
      return remote;
    }
    const forwarded = this.header("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = this.header("x-real-ip");
    if (realIp) return realIp.trim();
    return remote;
  }

  bearerToken(): string | undefined {
    const auth = this.header("authorization");
    if (!auth?.startsWith("Bearer ")) return undefined;
    return auth.slice(7);
  }

  /** `request.validate([...])` */
  async validate(rules: Rules): Promise<Record<string, unknown>> {
    await this.loadJson();
    return validate(this.all(), rules, {
      user: (this.user as { password?: string } | undefined) ?? null,
    });
  }

  /**
   * Whether the request URL has a valid signature.
   */
  hasValidSignature(absolute = false): boolean {
    if (!signatureChecker) {
      throw new Error(
        "Signed URL validation is not configured. Import @bunyad/router (or call Url.setKey).",
      );
    }
    return signatureChecker(this, absolute, []);
  }

  /** Relative (path-only) signature check. */
  hasValidRelativeSignature(): boolean {
    return this.hasValidSignature(false);
  }

  /** Signature check ignoring query keys. */
  hasValidSignatureWhileIgnoring(
    ignore: string[] = [],
    absolute = true,
  ): boolean {
    if (!signatureChecker) {
      throw new Error(
        "Signed URL validation is not configured. Import @bunyad/router (or call Url.setKey).",
      );
    }
    return signatureChecker(this, absolute, ignore);
  }

  /** Relative signature check ignoring query keys. */
  hasValidRelativeSignatureWhileIgnoring(ignore: string[] = []): boolean {
    return this.hasValidSignatureWhileIgnoring(ignore, false);
  }

  /**
   * Validate and flash field errors into a named bag on the session.
   * Views read the bag with `@error('field', 'bag')`.
   */
  async validateWithBag(
    errorBag: string,
    rules: Rules,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.validate(rules);
    } catch (error) {
      if (error instanceof ValidationException) error.withErrorBag(errorBag);
      throw error;
    }
  }


  /**
   * Copy parsed body / route / session onto another Request wrapper
   * (Form Request) without re-reading the raw body stream.
   */
  transferTo(target: Request): void {
    target.#params = this.#params;
    target.#models = this.#models;
    target.#query = this.#query;
    target.#json = this.#json;
    target.#files = this.#files;
    target.#jsonLoaded = this.#jsonLoaded;
    target.#remoteAddress = this.#remoteAddress;
    target.session = this.session;
    target.user = this.user;
    target.routeName = this.routeName;
    target.accessTokenId = this.accessTokenId;
  }
}

function isUploadedFileValue(value: unknown): boolean {
  return (
    value instanceof UploadedFile ||
    (Array.isArray(value) && value[0] instanceof UploadedFile)
  );
}

function flattenKeys(keys: string[] | [string[]]): string[] {
  if (keys.length === 1 && Array.isArray(keys[0])) return keys[0];
  return keys as string[];
}

/** Match a path against a Laravel-style pattern (`foo/*`, `*`). */
function matchPathPattern(path: string, pattern: string): boolean {
  if (pattern === "*" || pattern === path) return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(path);
}
