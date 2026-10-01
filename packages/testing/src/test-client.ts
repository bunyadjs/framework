import type { Authenticatable } from "@bunyad/auth";
import { Gate, getTokenGuard } from "@bunyad/auth";
import type { SessionStore } from "@bunyad/contracts";
import type { Application } from "@bunyad/core";
import { createFetchHandler } from "@bunyad/core";
import { Model } from "@bunyad/orm";
import { Request as HttpRequest } from "@bunyad/http";
import { refreshDatabase as refreshDatabaseTables } from "./refresh-database.ts";
import { wrapResponse, type TestResponse } from "./test-response.ts";

export type { TestResponse } from "./test-response.ts";
export { wrapResponse } from "./test-response.ts";

export type CreateApplicationFn = () => Promise<Application>;

/**
 * `BodyInit`/`BlobPart` aren't ambient here (base tsconfig `lib` is
 * `ESNext`-only, no DOM) — derive them from the real global constructors
 * instead of widening `lib` project-wide.
 */
type BodyInitLike = NonNullable<ConstructorParameters<typeof Request>[1]>["body"];
type BlobPartLike = NonNullable<ConstructorParameters<typeof Blob>[0]>[number];

export type TestClientOptions = {
  createApplication: CreateApplicationFn;
  baseUrl?: string;
  sessionCookie?: string;
  sessionKey?: string;
  /** When set, resets tables after boot. */
  migrationsPath?: string;
  seed?: () => void | Promise<void>;
};

/**
 * In-process HTTP test client with fluent request helpers.
 */
export class TestClient {
  readonly app: Application;
  readonly #fetch: (request: Request) => Response | Promise<Response>;
  readonly #baseUrl: string;
  readonly #sessionCookie: string;
  readonly #sessionKey: string;
  /** Cookie jar: name → raw value, sent on every request. */
  readonly #cookies = new Map<string, string>();
  #csrf: string | undefined;
  #bearer: string | undefined;
  #user: Authenticatable | undefined;
  #attachments: Array<{
    name: string;
    contents: Blob | File | string | Uint8Array;
    filename?: string;
  }> = [];

  private constructor(
    app: Application,
    fetch: (request: Request) => Response | Promise<Response>,
    options: {
      baseUrl: string;
      sessionCookie: string;
      sessionKey: string;
    },
  ) {
    this.app = app;
    this.#fetch = fetch;
    this.#baseUrl = options.baseUrl;
    this.#sessionCookie = options.sessionCookie;
    this.#sessionKey = options.sessionKey;
  }

  static async create(options: TestClientOptions): Promise<TestClient> {
    const app = await options.createApplication();
    const client = new TestClient(app, createFetchHandler(app), {
      baseUrl: options.baseUrl ?? "http://localhost",
      sessionCookie: options.sessionCookie ?? "bunyad_session",
      sessionKey: options.sessionKey ?? "login_web",
    });
    if (options.migrationsPath) {
      await client.refreshDatabase(options.migrationsPath, { seed: options.seed });
    }
    return client;
  }

  /** Reset tables on the booted app connection. */
  async refreshDatabase(
    migrationsPath: string,
    options: { seed?: () => void | Promise<void> } = {},
  ): Promise<this> {
    await refreshDatabaseTables({
      connection: Model.getConnection(),
      migrationsPath,
      seed: options.seed,
    });
    this.#user = undefined;
    this.#cookies.clear();
    this.#csrf = undefined;
    return this;
  }

  withToken(token: string): this {
    this.#bearer = token;
    return this;
  }

  withoutToken(): this {
    this.#bearer = undefined;
    return this;
  }

  /** Set a request cookie for subsequent calls. */
  withCookie(name: string, value: string): this {
    this.#cookies.set(name, value);
    return this;
  }

  /** Merge key/values into the current session bag. */
  async withSession(data: Record<string, unknown>): Promise<this> {
    await this.ensureSession();
    const sessionId = this.#sessionId();
    if (!sessionId) {
      throw new Error("withSession() requires an active session cookie.");
    }
    if (!this.app.bound("session.store")) {
      throw new Error('withSession() requires app.instance("session.store").');
    }
    const store = this.app.make<SessionStore>("session.store");
    const existing = (await store.read(sessionId)) ?? {};
    await store.write(sessionId, { ...existing, ...data });
    return this;
  }

  /** Clear the current session bag (keeps the cookie). */
  async flushSession(): Promise<this> {
    await this.ensureSession();
    const sessionId = this.#sessionId();
    if (!sessionId || !this.app.bound("session.store")) return this;
    const store = this.app.make<SessionStore>("session.store");
    await store.write(sessionId, {});
    return this;
  }

  /** Attach a file for the next multipart POST/PUT/PATCH. */
  attach(
    name: string,
    contents: Blob | File | string | Uint8Array,
    filename?: string,
  ): this {
    this.#attachments.push({ name, contents, filename });
    return this;
  }

  /**
   * Authenticate as `user` for subsequent requests.
   *
   * With a session store this signs the user into the session. Pass `"token"` or a list
   * of abilities (Sanctum `actingAs($user, ['*'])`), or configure `auth.defaults.guard` as `token`, and
   * it issues a bearer token instead.
   */
  async actingAs(
    user: Authenticatable,
    guardOrAbilities?: string | string[],
  ): Promise<this> {
    const tokenGuard = getTokenGuard();
    const viaToken =
      Array.isArray(guardOrAbilities) ||
      guardOrAbilities === "token" ||
      (guardOrAbilities === undefined &&
        this.app.config.get("auth.defaults.guard") === "token");
    if (viaToken) {
      if (!tokenGuard) {
        throw new Error("actingAs() with a token needs a registered token guard.");
      }
      const token = await tokenGuard.createToken(user, "testing", {
        abilities: Array.isArray(guardOrAbilities) ? guardOrAbilities : ["*"],
      });
      this.#user = user;
      return this.withToken(token);
    }
    await this.ensureSession();
    const sessionId = this.#sessionId();
    if (!sessionId) {
      throw new Error("actingAs() requires an active session cookie.");
    }
    if (!this.app.bound("session.store")) {
      throw new Error(
        'actingAs() requires app.instance("session.store") (playground wires this).',
      );
    }
    const store = this.app.make<SessionStore>("session.store");
    const data = (await store.read(sessionId)) ?? {};
    data[this.#sessionKey] = user.id;
    await store.write(sessionId, data);
    this.#user = user;
    return this;
  }

  /** Check Gate authorization for the current acting user. */
  async can(ability: string, ...args: unknown[]): Promise<boolean> {
    return Gate.allows(this.#gateRequest(), ability, ...args);
  }

  async assertCan(ability: string, ...args: unknown[]): Promise<this> {
    if (!(await this.can(ability, ...args))) {
      throw new Error(`Expected ability [${ability}] to be allowed.`);
    }
    return this;
  }

  async assertCannot(ability: string, ...args: unknown[]): Promise<this> {
    if (await this.can(ability, ...args)) {
      throw new Error(`Expected ability [${ability}] to be denied.`);
    }
    return this;
  }

  #gateRequest(): HttpRequest {
    const request = new HttpRequest(new globalThis.Request(`${this.#baseUrl}/`));
    if (this.#user) request.user = this.#user;
    return request;
  }

  async get(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.request("GET", uri, undefined, headers);
  }

  async getJson(uri: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.get(uri, { Accept: "application/json", ...headers });
  }

  async post(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.request("POST", uri, data, headers);
  }

  async postJson(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.post(uri, data, {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    });
  }

  async put(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.request("PUT", uri, data, headers);
  }

  async putJson(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.put(uri, data, {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    });
  }

  async patch(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.request("PATCH", uri, data, headers);
  }

  async patchJson(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.patch(uri, data, {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...headers,
    });
  }

  async delete(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.request("DELETE", uri, data, headers);
  }

  async deleteJson(
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    const hdrs: Record<string, string> = {
      Accept: "application/json",
      ...headers,
    };
    if (data !== undefined) {
      hdrs["Content-Type"] = "application/json";
    }
    return this.delete(uri, data, hdrs);
  }

  async ensureSession(): Promise<this> {
    if (this.#sessionId() && this.#csrf) return this;
    const res = await this.#fetch(new Request(`${this.#baseUrl}/`));
    this.#capture(res);
    return this;
  }

  async request(
    method: string,
    uri: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    if (method !== "GET" && method !== "HEAD") {
      await this.ensureSession();
    }

    const hdrs = new Headers(headers);
    if (this.#cookies.size > 0) hdrs.set("cookie", this.#cookieHeader());
    if (this.#csrf && method !== "GET" && method !== "HEAD") {
      if (!hdrs.has("x-csrf-token")) hdrs.set("x-csrf-token", this.#csrf);
    }
    if (this.#bearer) hdrs.set("Authorization", `Bearer ${this.#bearer}`);

    let body: BodyInitLike | undefined;
    if (
      this.#attachments.length > 0 &&
      method !== "GET" &&
      method !== "HEAD"
    ) {
      const form = new FormData();
      if (data && typeof data === "object" && !(data instanceof FormData)) {
        for (const [key, value] of Object.entries(
          data as Record<string, unknown>,
        )) {
          form.append(key, value instanceof Blob ? value : String(value));
        }
      }
      for (const part of this.#attachments) {
        const blob =
          part.contents instanceof Blob
            ? part.contents
            : new Blob([part.contents as BlobPartLike]);
        form.append(part.name, blob, part.filename);
      }
      body = form;
      hdrs.delete("Content-Type");
      this.#attachments = [];
    } else if (data instanceof FormData) {
      body = data;
      hdrs.delete("Content-Type");
    } else if (data !== undefined && method !== "GET" && method !== "HEAD") {
      if (!hdrs.has("Content-Type")) {
        hdrs.set("Content-Type", "application/json");
      }
      body =
        hdrs.get("Content-Type")?.includes("application/json")
          ? JSON.stringify(data)
          : String(data);
    }

    const response = await this.#fetch(
      new Request(`${this.#baseUrl}${uri}`, { method, headers: hdrs, body }),
    );
    this.#capture(response);
    return wrapResponse(response);
  }

  #capture(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(";")[0]!;
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === "" || /;\s*Max-Age=0\b/i.test(header)) {
        this.#cookies.delete(name);
      } else {
        this.#cookies.set(name, value);
      }
    }
    const csrf = response.headers.get("X-CSRF-TOKEN");
    if (csrf) this.#csrf = csrf;
  }

  #cookieHeader(): string {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  #sessionId(): string | undefined {
    const value = this.#cookies.get(this.#sessionCookie);
    return value === undefined ? undefined : decodeURIComponent(value);
  }
}
