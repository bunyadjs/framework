import type { Request, Next } from "@bunyad/http";
import { factory, runInertiaRequest, type SharedPropValue } from "./factory.ts";

/**
 * Base Inertia middleware. Apps extend this as `HandleInertiaRequests`
 * under `app/Http/Middleware`.
 */
export class Middleware {
  /** Root template loaded on the first page visit. */
  protected rootViewName = "app";

  /** Current asset version (`null` disables version checks). */
  version(_request: Request): string | null | Promise<string | null> {
    return null;
  }

  /** Props shared on every Inertia response. */
  share(
    _request: Request,
  ):
    | Record<string, SharedPropValue>
    | Promise<Record<string, SharedPropValue>> {
    return {};
  }

  /** Root view name for the current request. */
  rootView(_request: Request): string {
    return this.rootViewName;
  }

  /** Called when the client asset version does not match. */
  onVersionChange(request: Request, _response: Response): Response {
    return factory.location(request.url);
  }

  async handle(request: Request, next: Next): Promise<Response> {
    // JSON / non-document clients never need Inertia share/version work.
    const inertia = isInertiaRequest(request);
    const accept = request.header("accept") ?? "";
    if (!inertia && !accept.includes("text/html")) {
      const response = await next();
      response.headers.set("Vary", "X-Inertia");
      return response;
    }

    // Everything set here belongs to this request only.
    return runInertiaRequest(async () => {
      factory.setRootView(this.rootView(request));
      factory.version(await this.version(request));
      factory.share("errors", resolveValidationErrors(request));
      factory.share(await this.share(request));

      if (inertia && request.method === "GET" && hasVersionMismatch(request)) {
        return this.onVersionChange(request, new Response(null, { status: 409 }));
      }

      const response = await next();
      return finalizeInertiaResponse(request, response);
    });
  }
}

/**
 * Build middleware without a subclass. Prefer a `HandleInertiaRequests`
 * class in application code.
 */
export function handleInertiaRequests(options: {
  rootView?: string;
  version?: string | number | null | (() => string | number | null);
  share?:
    | Record<string, SharedPropValue>
    | ((
        request: Request,
      ) =>
        | Record<string, SharedPropValue>
        | Promise<Record<string, SharedPropValue>>);
} = {}): Middleware {
  return new (class extends Middleware {
    constructor() {
      super();
      if (options.rootView) this.rootViewName = options.rootView;
    }

    override version(request: Request) {
      if (options.version === undefined) return super.version(request);
      const value =
        typeof options.version === "function"
          ? options.version()
          : options.version;
      return value == null ? null : String(value);
    }

    override share(request: Request) {
      if (!options.share) return super.share(request);
      return typeof options.share === "function"
        ? options.share(request)
        : options.share;
    }
  })();
}

export type HandleInertiaRequestsOptions = Parameters<
  typeof handleInertiaRequests
>[0];

/**
 * Flashed validation errors as `{ field: "first message" }`, the shape
 * Inertia's `useForm` reads. Named bags nest one level
 * (`{ userDeletion: { password: "…" } }`); an `X-Inertia-Error-Bag` header
 * puts the default bag under that name.
 */
export function resolveValidationErrors(request: Request): Record<string, unknown> {
  const flashed = request.session?.get<Record<string, unknown>>("errors") ?? {};
  const errors = firstMessages(flashed);
  const bag = request.header("x-inertia-error-bag");
  if (!bag || Object.keys(errors).length === 0 || bag in errors) return errors;
  return { [bag]: errors };
}

function firstMessages(bag: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (Array.isArray(value)) out[key] = String(value[0] ?? "");
    else if (typeof value === "string") out[key] = value;
    else if (value && typeof value === "object") out[key] = firstMessages(value as Record<string, unknown>);
  }
  return out;
}

function isInertiaRequest(request: Request): boolean {
  return request.header("x-inertia") === "true";
}

function hasVersionMismatch(request: Request): boolean {
  const client = request.header("x-inertia-version");
  if (client == null) return false;
  const server = factory.getVersion();
  if (server == null) return false;
  return client !== server;
}

async function finalizeInertiaResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  response.headers.set("Vary", "X-Inertia");

  if (!isInertiaRequest(request)) return response;

  if (
    response.status === 302 &&
    ["PUT", "PATCH", "DELETE"].includes(request.method)
  ) {
    const location = response.headers.get("Location");
    if (location) {
      return new Response(null, {
        status: 303,
        headers: mergeHeaders(response.headers, { Location: location }),
      });
    }
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("Location");
    if (location && isExternalRedirect(request, location)) {
      return factory.location(absoluteUrl(request, location));
    }
  }

  if (response.headers.get("X-Inertia") === "true") {
    const headers = new Headers(response.headers);
    headers.set("Vary", "X-Inertia");
    const version = factory.getVersion();
    if (version != null) headers.set("X-Inertia-Version", version);
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  }

  return response;
}

function isExternalRedirect(request: Request, location: string): boolean {
  try {
    const target = new URL(location, request.url);
    const current = new URL(request.url);
    return target.origin !== current.origin;
  } catch {
    return false;
  }
}

function absoluteUrl(request: Request, location: string): string {
  return new URL(location, request.url).toString();
}

function mergeHeaders(
  base: Headers,
  extra: Record<string, string>,
): Headers {
  const headers = new Headers(base);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return headers;
}
