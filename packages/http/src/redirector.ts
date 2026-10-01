/**
 * Fluent `redirect()` / `redirect()->back()` (and related helpers).
 */
export type RedirectUrlGenerator = {
  to(path: string): string;
  previous(fallback?: string): string;
  current(): string;
  route(
    name: string,
    params?: Record<string, unknown>,
    absolute?: boolean,
  ): string;
  action(
    target: [new () => object, string] | (new () => object),
    params?: Record<string, unknown>,
    absolute?: boolean,
  ): string;
};

export type RedirectFlashSession = {
  flash(key: string, value: unknown): void;
  put?(key: string, value: unknown): unknown;
  get?(key: string, defaultValue?: unknown): unknown;
  pull?(key: string, defaultValue?: unknown): unknown;
};

export type RedirectInputSource = {
  all(): Record<string, unknown>;
};

const defaultGenerator: RedirectUrlGenerator = {
  to(path) {
    if (/^https?:\/\//i.test(path) || path.startsWith("/")) return path;
    return `/${path}`;
  },
  previous(fallback = "/") {
    return this.to(fallback);
  },
  current() {
    return "/";
  },
  route(name) {
    throw new Error(
      `redirect()->route('${name}') requires the router URL generator (is handleUrl / Url wired?).`,
    );
  },
  action() {
    throw new Error(
      "redirect()->action() requires the router URL generator (is handleUrl / Url wired?).",
    );
  },
};

let urls: RedirectUrlGenerator = defaultGenerator;
let sessionGetter: () => RedirectFlashSession | undefined = () => undefined;
let inputGetter: () => RedirectInputSource | undefined = () => undefined;

/** Bind `Url` / named routes (called from `@bunyad/router`). */
export function setRedirectUrlGenerator(
  generator: RedirectUrlGenerator,
): void {
  urls = generator;
}

export function getRedirectUrlGenerator(): RedirectUrlGenerator {
  return urls;
}

/** Bind session flash for `with` / `withInput` / `withErrors`. */
export function setRedirectFlashAccessor(
  getSession: () => RedirectFlashSession | undefined,
  getInput?: () => RedirectInputSource | undefined,
): void {
  sessionGetter = getSession;
  if (getInput) inputGetter = getInput;
}

/** The current flash accessors, so tests can put them back. */
export function getRedirectFlashAccessor(): [
  () => RedirectFlashSession | undefined,
  () => RedirectInputSource | undefined,
] {
  return [sessionGetter, inputGetter];
}

const SECRET_KEYS = new Set(["password", "password_confirmation", "_token"]);

/**
 * Redirect Response with Laravel-style flash helpers.
 * Flash runs immediately while the request session is still live.
 */
export class RedirectResponse extends Response {
  with(key: string | Record<string, unknown>, value?: unknown): this {
    const session = sessionGetter();
    if (!session) return this;
    if (typeof key === "string") {
      session.flash(key, value);
    } else {
      for (const [k, v] of Object.entries(key)) {
        session.flash(k, v);
      }
    }
    return this;
  }

  withInput(input?: Record<string, unknown>): this {
    const session = sessionGetter();
    if (!session) return this;
    const data = input ?? inputGetter()?.all() ?? {};
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!SECRET_KEYS.has(k)) filtered[k] = v;
    }
    session.flash("_old", filtered);
    return this;
  }

  withErrors(errors: Record<string, unknown> | string[] | string): this {
    const session = sessionGetter();
    if (!session) return this;
    session.flash("errors", errors);
    return this;
  }
}

function makeRedirect(
  location: string,
  status = 302,
  headers: Record<string, string> = {},
): RedirectResponse {
  return new RedirectResponse(null, {
    status,
    headers: { Location: location, ...headers },
  });
}

/**
 * Fluent redirect builder — `redirect()->back()`, `redirect()->route(...)`, …
 */
export class Redirector {
  /** Redirect to a path or absolute URL. */
  to(
    path: string,
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    return makeRedirect(urls.to(path), status, headers);
  }

  /** Redirect to an external URL (no path rewriting). */
  away(
    path: string,
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    return makeRedirect(path, status, headers);
  }

  /** Redirect to HTTPS variant of `path`. */
  secure(
    path: string,
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    const target = urls.to(path).replace(/^http:/i, "https:");
    return makeRedirect(target, status, headers);
  }

  /**
   * Redirect to the previous location (session `_previous.url`, then Referer).
   * `fallback` is used when no previous URL is available (`false` → `/`).
   */
  back(
    status = 302,
    headers: Record<string, string> = {},
    fallback: string | false = false,
  ): RedirectResponse {
    const fb = fallback === false ? "/" : String(fallback);
    return makeRedirect(urls.previous(fb), status, headers);
  }

  /** Redirect to the current request URI. */
  refresh(
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    return makeRedirect(urls.current(), status, headers);
  }

  /** Redirect to `/`. */
  home(
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    return this.to("/", status, headers);
  }

  /**
   * Redirect to the URL the guest was trying to reach (session `url.intended`),
   * or `defaultPath` when none is stored.
   */
  intended(
    defaultPath = "/",
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    const session = sessionGetter();
    let target = defaultPath;
    if (session?.pull) {
      const stored = session.pull("url.intended", defaultPath);
      if (typeof stored === "string" && stored.length > 0) target = stored;
    }
    return this.to(target, status, headers);
  }

  /** Redirect to a named route. */
  route(
    name: string,
    params: Record<string, unknown> = {},
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    return makeRedirect(urls.route(name, params), status, headers);
  }

  /** Redirect to a controller action. */
  action(
    target: [new () => object, string] | (new () => object),
    params: Record<string, unknown> = {},
    status = 302,
    headers: Record<string, string> = {},
  ): RedirectResponse {
    return makeRedirect(urls.action(target, params), status, headers);
  }
}

/**
 * `redirect('/path')` → RedirectResponse
 * `redirect()` → Redirector (`redirect()->back()`, `redirect()->route(...)`, …)
 */
export function redirect(): Redirector;
export function redirect(
  to: string,
  status?: number,
  headers?: Record<string, string>,
): RedirectResponse;
export function redirect(
  to?: string | null,
  status = 302,
  headers: Record<string, string> = {},
): Redirector | RedirectResponse {
  if (to === undefined || to === null) return new Redirector();
  return new Redirector().to(to, status, headers);
}

/** `to_route('name', params)` — redirect to a named route. */
export function to_route(
  name: string,
  params: Record<string, unknown> = {},
  status = 302,
  headers: Record<string, string> = {},
): RedirectResponse {
  return new Redirector().route(name, params, status, headers);
}
