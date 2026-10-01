import { ServiceProvider } from "@bunyad/core";
import type { Connection } from "@bunyad/database";
import type { SessionStore } from "@bunyad/contracts";
import { aliasMiddleware } from "@bunyad/http";
import {
  DatabaseSessionStore,
  FileSessionStore,
  MemorySessionStore,
  RedisSessionStore,
  maybeEncryptSessionStore,
  setSessionStore,
  setSessionOptions,
  blockSession,
} from "@bunyad/session";
import { addEncryptedCookieExcept } from "@bunyad/http";
import { resolveRedisUrl } from "./database-config.ts";

export type SessionConfig = {
  /** file | database | redis | memory | array */
  driver?: string;
  /** Lifetime in minutes. */
  lifetime?: number;
  /** Session cookie name (default `bunyad_session`). */
  cookie?: string;
  /** File driver directory (absolute). */
  files?: string;
  /** Database connection name (default connection when omitted). */
  connection?: string;
  /** Database sessions table. */
  table?: string;
  /** Redis connection name from `database.redis`. */
  store?: string;
  /** Redis key prefix. */
  prefix?: string;
  /** When false, skip payload encryption even if APP_KEY is set. */
  encrypt?: boolean;
};

function createSessionStore(
  app: ServiceProvider["app"],
  config: SessionConfig,
): SessionStore {
  const driver =
    config.driver ?? process.env.SESSION_DRIVER ?? "file";
  const lifetime =
    config.lifetime ?? Number(process.env.SESSION_LIFETIME ?? 120);

  if (driver === "memory" || driver === "array") {
    return new MemorySessionStore();
  }

  if (driver === "database") {
    const connection = app.make<Connection>("db");
    return new DatabaseSessionStore({
      connection,
      table: config.table ?? process.env.SESSION_TABLE ?? "sessions",
      lifetime,
    });
  }

  if (driver === "redis") {
    return new RedisSessionStore({
      url: resolveRedisUrl(app, config.store ?? "default"),
      prefix: config.prefix ?? "bunyad_session:",
      lifetime,
    });
  }

  // file (default)
  return new FileSessionStore({
    path:
      config.files ??
      app.storagePath("framework/sessions"),
    lifetime,
  });
}

/**
 * Registers `session.store` from `config/session.ts`.
 */
export class SessionServiceProvider extends ServiceProvider {
  register(): void {
    const config = this.app.config.get<SessionConfig>("session") ?? {};
    const lifetime =
      config.lifetime ?? Number(process.env.SESSION_LIFETIME ?? 120);
    const cookie = config.cookie ?? "bunyad_session";
    let store = createSessionStore(this.app, config);
    if (config.encrypt !== false) {
      store = maybeEncryptSessionStore(store);
    }
    setSessionStore(store);
    setSessionOptions({ lifetime, cookie });
    this.app.instance("session.store", store);

    // Session cookie + XSRF stay clear of app-cookie encryption (documented).
    addEncryptedCookieExcept([cookie, "XSRF-TOKEN"]);

    aliasMiddleware("block", (lockSeconds, waitSeconds) =>
      blockSession(
        lockSeconds != null && lockSeconds !== ""
          ? Number(lockSeconds)
          : 10,
        waitSeconds != null && waitSeconds !== ""
          ? Number(waitSeconds)
          : 10,
      ),
    );
  }
}
