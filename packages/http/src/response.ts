import { basename } from "node:path";
import { BunyadError } from "@bunyad/common";
import { encryptCookieValue } from "./cookie-encryption.ts";

/** Compatible with `new Headers(...)` (no DOM `HeadersInit` in package tsconfig). */
type ResponseHeadersInit = ConstructorParameters<typeof Headers>[0];

type MacroFn = (this: HttpResponse, ...args: unknown[]) => unknown;
type MixinObject = Record<string, MacroFn>;

const responseMacros = new Map<string, MacroFn>();

/**
 * Fetch Response helpers plus a fluent builder for header/cookie/status tweaks.
 */
export class HttpResponse {
  #content = "";
  #status = 200;
  #headers = new Headers();
  #original: unknown;
  #exception: unknown;

  static make(
    body?: string | Uint8Array | ReadableStream | null,
    init?: ResponseInit,
  ): Response {
    return new Response(body, init);
  }

  static json(
    data: unknown,
    status = 200,
    headers?: ResponseHeadersInit,
  ): Response {
    return json(data, status, headers);
  }

  static redirect(url: string, status = 302): Response {
    return new Response(null, {
      status,
      headers: { Location: url },
    });
  }

  static text(body: string, status = 200): Response {
    return new Response(body, {
      status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  /** Create a fluent response instance. */
  static from(content = "", status = 200): HttpResponse {
    const res = new HttpResponse();
    res.#content = content;
    res.#status = status;
    res.#original = content;
    return res;
  }

  /** Register a macro callable on fluent builders and `response()`. */
  static macro(name: string, callback: MacroFn): void {
    if (!name || typeof callback !== "function") {
      throw new TypeError("Response.macro requires a name and function.");
    }
    responseMacros.set(name, callback);
    applyMacroToFactory(name, callback);
  }

  /** Register several macros from an object of methods. */
  static mixin(mixin: MixinObject): void {
    for (const [name, callback] of Object.entries(mixin)) {
      HttpResponse.macro(name, callback);
    }
  }

  /** Whether a macro is registered. */
  static hasMacro(name: string): boolean {
    return responseMacros.has(name);
  }

  /** Drop all macros (tests). */
  static flushMacros(): void {
    for (const name of responseMacros.keys()) {
      delete (response as Record<string, unknown>)[name];
    }
    responseMacros.clear();
  }

  content(): string {
    return this.#content;
  }

  getContent(): string {
    return this.#content;
  }

  setContent(content: string): this {
    this.#content = content;
    this.#original = content;
    return this;
  }

  getOriginalContent(): unknown {
    return this.#original;
  }

  status(): number {
    return this.#status;
  }

  statusText(): string {
    return statusTextFor(this.#status);
  }

  withHeaders(headers: Record<string, string>): this {
    for (const [key, value] of Object.entries(headers)) {
      this.#headers.set(key, value);
    }
    return this;
  }

  withoutHeader(name: string): this {
    this.#headers.delete(name);
    return this;
  }

  withCookie(
    name: string,
    value: string,
    options: {
      path?: string;
      domain?: string;
      maxAge?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
      /** Skip encryption for this cookie even when encryption is on. */
      encrypt?: boolean;
    } = {},
  ): this {
    const raw =
      options.encrypt === false ? value : encryptCookieValue(name, value);
    const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(raw)}`];
    if (options.path) parts.push(`Path=${options.path}`);
    if (options.domain) parts.push(`Domain=${options.domain}`);
    if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
    if (options.httpOnly) parts.push("HttpOnly");
    if (options.secure) parts.push("Secure");
    if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
    this.#headers.append("Set-Cookie", parts.join("; "));
    return this;
  }

  withCookies(
    cookies: Record<string, string>,
    options?: Parameters<HttpResponse["withCookie"]>[2],
  ): this {
    for (const [name, value] of Object.entries(cookies)) {
      this.withCookie(name, value, options);
    }
    return this;
  }

  withoutCookie(name: string): this {
    return this.withCookie(name, "", { maxAge: 0, path: "/" });
  }

  withException(exception: unknown): this {
    this.#exception = exception;
    return this;
  }

  header(name: string, value?: string): string | null | this {
    if (value === undefined) return this.#headers.get(name);
    this.#headers.set(name, value);
    return this;
  }

  cookie(
    name: string,
    value: string,
    options?: Parameters<HttpResponse["withCookie"]>[2],
  ): this {
    return this.withCookie(name, value, options);
  }

  shouldBeJson(): boolean {
    const type = this.#headers.get("content-type") ?? "";
    return type.includes("json") || this.#original != null && typeof this.#original === "object";
  }

  morphToJson(data: unknown): this {
    this.#content = JSON.stringify(data);
    this.#original = data;
    this.#headers.set("Content-Type", "application/json");
    return this;
  }

  /** JSONP callback name when present (Fetch has none). */
  getCallback(): string | null {
    return null;
  }

  throwResponse(): never {
    throw this.#exception ?? new HttpException(this.#status, this.#content);
  }

  /** Convert to a Fetch Response. */
  toFetch(): Response {
    return new Response(this.#content, {
      status: this.#status,
      statusText: this.statusText(),
      headers: this.#headers,
    });
  }
}

function statusTextFor(status: number): string {
  const map: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
  };
  return map[status] ?? "";
}

export type ResponseBody = string | Uint8Array | ReadableStream | null;

const JSON_HEADERS = {
  "Content-Type": "application/json;charset=utf-8",
};

const JSON_OK: ResponseInit = { headers: JSON_HEADERS };

export function json(
  data: unknown,
  status = 200,
  headers?: ResponseHeadersInit,
): Response {
  const body = JSON.stringify(data);
  if (!headers) {
    return status === 200
      ? new Response(body, JSON_OK)
      : new Response(body, { status, headers: JSON_HEADERS });
  }
  const merged = new Headers(JSON_HEADERS);
  new Headers(headers).forEach((value, key) => {
    merged.set(key, value);
  });
  return new Response(body, { status, headers: merged });
}

export {
  Redirector,
  RedirectResponse,
  redirect,
  to_route,
  setRedirectUrlGenerator,
  getRedirectUrlGenerator,
  setRedirectFlashAccessor,
  getRedirectFlashAccessor,
  type RedirectUrlGenerator,
} from "./redirector.ts";
import { redirect } from "./redirector.ts";

export class HttpException extends BunyadError {
  readonly headers: Record<string, string>;

  constructor(
    readonly status: number,
    message?: string,
    headers: Record<string, string> = {},
  ) {
    const label = statusTextFor(status);
    super(
      message && message.length > 0 ? message : label || `HTTP ${status}`,
      `BUNYAD_HTTP_${status}`,
    );
    this.name = "HttpException";
    this.headers = { ...headers };
  }
}

/**
 * Short-circuit the kernel with a ready Response (e.g. route `missing()`).
 */
export class HttpResponseException extends BunyadError {
  constructor(readonly response: Response) {
    super("HTTP response", "BUNYAD_HTTP_RESPONSE");
    this.name = "HttpResponseException";
  }
}

/** Laravel `abort($code, $message = '', array $headers = [])`. */
export function abort(
  status: number,
  message?: string,
  headers?: Record<string, string>,
): never {
  throw new HttpException(status, message, headers);
}

/** Abort when condition is truthy. */
export function abort_if(
  condition: unknown,
  status: number,
  message?: string,
  headers?: Record<string, string>,
): void {
  if (condition) abort(status, message, headers);
}

/** Abort when condition is falsy. */
export function abort_unless(
  condition: unknown,
  status: number,
  message?: string,
  headers?: Record<string, string>,
): void {
  if (!condition) abort(status, message, headers);
}

export type StreamWrite = (chunk: string | Uint8Array) => void;

/**
 * Laravel `response()->stream($callback)` — ReadableStream body.
 * Callback receives a `write` function (and may be async).
 */
export function stream(
  callback: (write: StreamWrite) => void | Promise<void>,
  headers: ResponseHeadersInit = {},
  status = 200,
): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const write: StreamWrite = (chunk) => {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      };
      try {
        await callback(write);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  const h = new Headers(headers);
  if (!h.has("Content-Type")) {
    h.set("Content-Type", "text/plain; charset=utf-8");
  }
  return new Response(body, { status, headers: h });
}

/**
 * Laravel `response()->streamJson($data)` — NDJSON stream of values
 * (arrays / async iterables / sync iterables / factory).
 */
export function streamJson(
  data:
    | Iterable<unknown>
    | AsyncIterable<unknown>
    | (() => Iterable<unknown> | AsyncIterable<unknown>),
  headers: ResponseHeadersInit = {},
  status = 200,
): Response {
  const source = typeof data === "function" ? data() : data;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const item of source as AsyncIterable<unknown>) {
          controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  const h = new Headers(headers);
  if (!h.has("Content-Type")) {
    h.set("Content-Type", "application/x-ndjson; charset=utf-8");
  }
  return new Response(body, { status, headers: h });
}

export type EventStreamSend = (
  data: unknown,
  event?: string,
  id?: string,
) => void;

/**
 * Laravel `response()->eventStream($callback)` — Server-Sent Events.
 */
export function eventStream(
  callback: (send: EventStreamSend) => void | Promise<void>,
  headers: ResponseHeadersInit = {},
  status = 200,
): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send: EventStreamSend = (data, event, id) => {
        let chunk = "";
        if (event) chunk += `event: ${event}\n`;
        if (id != null) chunk += `id: ${id}\n`;
        const payload =
          typeof data === "string" ? data : JSON.stringify(data);
        for (const line of payload.split("\n")) {
          chunk += `data: ${line}\n`;
        }
        chunk += "\n";
        controller.enqueue(encoder.encode(chunk));
      };
      try {
        await callback(send);
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  const h = new Headers(headers);
  h.set("Content-Type", "text/event-stream; charset=utf-8");
  h.set("Cache-Control", "no-cache");
  h.set("Connection", "keep-alive");
  return new Response(body, { status, headers: h });
}

/**
 * Laravel `response()->streamDownload($callback, $name)` — attachment stream.
 */
export function streamDownload(
  callback: (write: StreamWrite) => void | Promise<void>,
  name: string,
  headers: ResponseHeadersInit = {},
  status = 200,
): Response {
  const h = new Headers(headers);
  if (!h.has("Content-Type")) {
    h.set("Content-Type", "application/octet-stream");
  }
  h.set(
    "Content-Disposition",
    `attachment; filename="${name.replace(/"/g, "")}"`,
  );
  return stream(callback, h, status);
}


/**
 * Laravel `response()->download($path, $name)` — attachment from a filesystem path.
 * Uses `Bun.file` (zero-copy) when available.
 */
export function download(
  path: string,
  name?: string,
  headers: ResponseHeadersInit = {},
): Response {
  const file = Bun.file(path);
  const filename = name ?? basename(path);
  const h = new Headers(headers);
  if (!h.has("Content-Type")) {
    h.set("Content-Type", file.type || "application/octet-stream");
  }
  h.set(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/"/g, "")}"`,
  );
  return new Response(file, { headers: h });
}

/**
 * Laravel `response()->file($path)` — inline file response.
 */
export function file(path: string, headers: ResponseHeadersInit = {}): Response {
  const bunFile = Bun.file(path);
  const h = new Headers(headers);
  if (!h.has("Content-Type")) {
    h.set("Content-Type", bunFile.type || "application/octet-stream");
  }
  return new Response(bunFile, { headers: h });
}

/** Empty body response (`response().noContent()` / `noContent()`). */
export function noContent(status = 204): Response {
  return new Response(null, { status });
}

/**
 * JSON / file / stream / redirect factory.
 * `response()` (no args) returns this object so `response().json(data)` works.
 * `response(body, init)` still builds a Fetch Response.
 * Macros registered via `Response.macro` / `response.macro` appear as methods.
 */
export interface ResponseFactory {
  (): ResponseFactory;
  (body?: ResponseBody, init?: ResponseInit): Response;
  json: typeof json;
  stream: typeof stream;
  streamJson: typeof streamJson;
  eventStream: typeof eventStream;
  streamDownload: typeof streamDownload;
  download: typeof download;
  file: typeof file;
  noContent: typeof noContent;
  redirect: typeof redirect;
  make: typeof HttpResponse.make;
  macro: typeof HttpResponse.macro;
  mixin: typeof HttpResponse.mixin;
  hasMacro: typeof HttpResponse.hasMacro;
  flushMacros: typeof HttpResponse.flushMacros;
  [macro: string]: unknown;
}

function createResponse(): ResponseFactory;
function createResponse(body?: ResponseBody, init?: ResponseInit): Response;
function createResponse(
  body?: ResponseBody,
  init?: ResponseInit,
): Response | ResponseFactory {
  if (arguments.length === 0) {
    return response;
  }
  return HttpResponse.make(body, init);
}

function applyMacroToFactory(name: string, callback: MacroFn): void {
  (response as Record<string, unknown>)[name] = (...args: unknown[]) => {
    const builder = HttpResponse.from();
    return callback.apply(builder, args);
  };
}

export const response: ResponseFactory = Object.assign(createResponse, {
  stream,
  streamJson,
  eventStream,
  streamDownload,
  download,
  file,
  noContent,
  json,
  redirect,
  make: HttpResponse.make,
  macro: HttpResponse.macro.bind(HttpResponse),
  mixin: HttpResponse.mixin.bind(HttpResponse),
  hasMacro: HttpResponse.hasMacro.bind(HttpResponse),
  flushMacros: HttpResponse.flushMacros.bind(HttpResponse),
}) as ResponseFactory;
