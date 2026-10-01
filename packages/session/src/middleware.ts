import type { SessionStore } from "@bunyad/contracts";
import type { Request, Next } from "@bunyad/http";
import { Session } from "./session.ts";

let defaultStore: SessionStore | undefined;
let defaultOptions: StartSessionOptions = {};

/** Bound by SessionServiceProvider (Laravel session manager default driver). */
export function setSessionStore(store: SessionStore | undefined): void {
  defaultStore = store;
}

export function getSessionStore(): SessionStore | undefined {
  return defaultStore;
}

/** Defaults merged into every `startSession()` call (lifetime, cookie flags). */
export function setSessionOptions(options: StartSessionOptions): void {
  defaultOptions = { ...options };
}

export function getSessionOptions(): StartSessionOptions {
  return { ...defaultOptions };
}

export type CookieSameSite = "Lax" | "Strict" | "None";

export type StartSessionOptions = {
  /** Defaults to the store registered via `setSessionStore`. */
  store?: SessionStore;
  cookie?: string;
  /**
   * Session lifetime in minutes (Laravel `lifetime`).
   * Sets cookie `Max-Age` when provided.
   */
  lifetime?: number;
  /**
   * Set the Secure flag on the session cookie.
   * Default: true when the request is HTTPS, or when APP_ENV/NODE_ENV is production.
   * Always true when `sameSite` is `None` (browser requirement).
   */
  secure?: boolean;
  /** Cookie Domain attribute. */
  domain?: string;
  /** SameSite attribute (default Lax). */
  sameSite?: CookieSameSite;
};

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function isProductionEnv(): boolean {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "production";
  return env === "production";
}

function shouldSecureCookie(
  request: Request,
  option: boolean | undefined,
  sameSite?: CookieSameSite,
): boolean {
  // Browsers require Secure when SameSite=None (Laravel cookie jar parity).
  if (sameSite === "None") return true;
  if (option !== undefined) return option;
  if (typeof request.secure === "function" && request.secure()) return true;
  return isProductionEnv();
}

function appendSessionCookie(
  response: Response,
  cookieName: string,
  id: string,
  options: {
    secure?: boolean;
    domain?: string;
    sameSite?: CookieSameSite;
    lifetime?: number;
  } = {},
): void {
  const sameSite = options.sameSite ?? "Lax";
  let cookie =
    `${cookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=${sameSite}`;
  if (options.secure) cookie += "; Secure";
  if (options.domain) cookie += `; Domain=${options.domain}`;
  if (options.lifetime !== undefined && options.lifetime >= 0) {
    cookie += `; Max-Age=${Math.floor(options.lifetime * 60)}`;
  }
  response.headers.append("Set-Cookie", cookie);
}

function shouldEstablishSession(response: Response): boolean {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("text/html")) return true;
  if (response.headers.get("x-inertia") === "true") return true;
  return false;
}

/**
 * Load session from cookie + store, attach to request, persist after response.
 */
export function startSession(options: StartSessionOptions = {}) {
  const merged: StartSessionOptions = { ...defaultOptions, ...options };
  const cookieName = merged.cookie ?? "bunyad_session";

  return {
    async handle(request: Request, next: Next) {
      const store = merged.store ?? defaultStore;
      if (!store) {
        throw new Error(
          "Session store is not configured. Register SessionServiceProvider or pass store.",
        );
      }

      const cookies = parseCookies(request.header("cookie"));
      let id = cookies[cookieName];
      let created = false;
      const probe = new Session();
      if (!id || !probe.isValidId(id)) {
        id = probe.generateSessionId();
        created = true;
      }

      const data = created ? {} : ((await store.read(id)) ?? {});
      const session = new Session(data, id);
      session.setName(cookieName);
      session.start();
      request.session = session;

      const response = await next();
      session.ageFlashData();

      const regeneration = session.consumeRegeneration();
      if (regeneration) {
        if (regeneration.destroyOld) {
          await store.destroy(regeneration.oldId);
        }
        id = regeneration.newId;
        created = true;
      }

      const dirty = session.isDirty();
      const persist =
        regeneration != null ||
        dirty ||
        (created && shouldEstablishSession(response));

      if (persist) {
        await store.write(id, session.toJSON());
      }

      // Refresh cookie on create/persist so Max-Age tracks activity.
      if (created && persist) {
        appendSessionCookie(response, cookieName, id, {
          secure: shouldSecureCookie(
            request,
            merged.secure,
            merged.sameSite,
          ),
          domain: merged.domain,
          sameSite: merged.sameSite,
          lifetime: merged.lifetime,
        });
      } else if (persist && merged.lifetime !== undefined) {
        appendSessionCookie(response, cookieName, id, {
          secure: shouldSecureCookie(
            request,
            merged.secure,
            merged.sameSite,
          ),
          domain: merged.domain,
          sameSite: merged.sameSite,
          lifetime: merged.lifetime,
        });
      }
      return response;
    },
  };
}
