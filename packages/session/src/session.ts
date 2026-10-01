import { blockSession } from "./block.ts";

/**
 * Session bag with flash data, CSRF token, and previous-URL helpers.
 */
export class Session {
  #attributes: Record<string, unknown>;
  #flash: Record<string, unknown> = {};
  #nowKeys = new Set<string>();
  #id: string | undefined;
  #name = "bunyad_session";
  #started = false;
  #pendingRegenerate = false;
  #destroyOldOnRegenerate = false;
  #previousId: string | undefined;
  #handler: SessionHandler | undefined;
  #saveCallback: ((session: Session) => void | Promise<void>) | undefined;
  #dirty = false;
  /** When true, mutations (e.g. bootstrap CSRF token) do not mark dirty. */
  #silent = false;

  /**
   * Opt-in concurrent lock middleware for routes that write the session.
   * `Session.block(10, 10)` — hold up to `lockSeconds`, wait up to `waitSeconds`.
   */
  static block(lockSeconds = 10, waitSeconds = 10) {
    return blockSession(lockSeconds, waitSeconds);
  }

  constructor(attributes: Record<string, unknown> = {}, id?: string) {
    this.#attributes = { ...attributes };
    this.#id = id;
  }

  #touch(): void {
    if (!this.#silent) this.#dirty = true;
  }

  /** True when attributes changed and should be persisted. */
  isDirty(): boolean {
    return this.#dirty;
  }

  /** Current session id. */
  id(): string {
    return this.#id ?? "";
  }

  getId(): string {
    return this.id();
  }

  /** Assign the session id (middleware). */
  setId(id: string): this {
    this.#id = this.isValidId(id) ? id : this.generateSessionId();
    return this;
  }

  getName(): string {
    return this.#name;
  }

  setName(name: string): this {
    this.#name = name;
    return this;
  }

  isStarted(): boolean {
    return this.#started;
  }

  /** Mark the session as started (middleware). */
  start(): boolean {
    this.#started = true;
    if (!this.exists("_token")) {
      this.#silent = true;
      this.regenerateToken();
      this.#silent = false;
    }
    return true;
  }

  isValidId(id: string): boolean {
    if (typeof id !== "string" || id.length === 0) return false;
    if (/^[a-f0-9]{40}$/i.test(id)) return true;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    );
  }

  generateSessionId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Buffer.from(bytes).toString("hex");
  }

  all(): Record<string, unknown> {
    return { ...this.#attributes };
  }

  only(keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.exists(key)) out[key] = this.#attributes[key];
    }
    return out;
  }

  except(keys: string[]): Record<string, unknown> {
    const skip = new Set(keys);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.#attributes)) {
      if (!skip.has(key)) out[key] = value;
    }
    return out;
  }

  get<T = unknown>(key: string, defaultValue?: T): T {
    return (this.exists(key) ? this.#attributes[key] : defaultValue) as T;
  }

  /** Get a value and remove it. */
  pull<T = unknown>(key: string, defaultValue?: T): T {
    const value = this.get<T>(key, defaultValue);
    this.forget(key);
    return value;
  }

  /** Remove a key and return its previous value. */
  remove(key: string): unknown {
    const value = this.get(key);
    this.forget(key);
    return value;
  }

  put(key: string | Record<string, unknown>, value?: unknown): this {
    if (typeof key === "object") {
      for (const [k, v] of Object.entries(key)) this.#attributes[k] = v;
      this.#touch();
      return this;
    }
    this.#attributes[key] = value;
    this.#touch();
    return this;
  }

  /** Replace all attributes. */
  replace(attributes: Record<string, unknown>): this {
    this.#attributes = { ...attributes };
    this.#touch();
    return this;
  }

  /** Push a value onto a session array. */
  push(key: string, value: unknown): this {
    const current = this.get<unknown[]>(key, []);
    const list = Array.isArray(current) ? [...current] : [];
    list.push(value);
    this.put(key, list);
    return this;
  }

  increment(key: string, amount = 1): number {
    const next = Number(this.get(key, 0)) + amount;
    this.put(key, next);
    return next;
  }

  decrement(key: string, amount = 1): number {
    return this.increment(key, -amount);
  }

  /** Get existing value or compute and store it. */
  remember<T>(key: string, callback: () => T): T {
    if (this.exists(key)) return this.get<T>(key);
    const value = callback();
    this.put(key, value);
    return value;
  }

  /** True when the key exists and is not `null`. */
  has(key: string | string[]): boolean {
    const keys = Array.isArray(key) ? key : [key];
    return keys.every((k) => this.exists(k) && this.#attributes[k] !== null);
  }

  hasAny(keys: string[]): boolean {
    return keys.some((k) => this.has(k));
  }

  /** True when the key is present. */
  exists(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.#attributes, key);
  }

  /** Inverse of `exists`. */
  missing(key: string): boolean {
    return !this.exists(key);
  }

  forget(key: string | string[]): this {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) delete this.#attributes[k];
    this.#touch();
    return this;
  }

  /** Remove all session data. */
  flush(): this {
    this.#attributes = {};
    this.#flash = {};
    this.#nowKeys.clear();
    this.#touch();
    return this;
  }

  flash(key: string, value: unknown): this {
    this.#flash[key] = value;
    this.#attributes[key] = value;
    this.#touch();
    return this;
  }

  /** Flash the entire input bag under `_old_input`. */
  flashInput(input: Record<string, unknown>): this {
    this.flash("_old_input", input);
    return this;
  }

  getOldInput<T = unknown>(key?: string, defaultValue?: T): T {
    const old = this.get<Record<string, unknown>>("_old_input", {});
    if (key == null) return old as T;
    return (Object.prototype.hasOwnProperty.call(old, key)
      ? old[key]
      : defaultValue) as T;
  }

  hasOldInput(key?: string): boolean {
    const old = this.get<Record<string, unknown> | undefined>("_old_input");
    if (old == null) return false;
    if (key == null) return Object.keys(old).length > 0;
    return Object.prototype.hasOwnProperty.call(old, key);
  }

  /** Flash data only for the remainder of this request. */
  now(key: string, value: unknown): this {
    this.put(key, value);
    this.#nowKeys.add(key);
    return this;
  }

  /** Keep old flash data for another request. */
  reflash(): this {
    const old = (this.#attributes._flash as string[] | undefined) ?? [];
    for (const key of old) {
      if (this.exists(key)) this.#flash[key] = this.#attributes[key];
    }
    this.#attributes._flash = [];
    this.#touch();
    return this;
  }

  /** Keep specific keys flashed for another request. */
  keep(...keys: string[]): this {
    const flat = keys.flat();
    const old = (this.#attributes._flash as string[] | undefined) ?? [];
    const keepSet = new Set(flat);
    for (const key of flat) {
      if (this.exists(key)) this.#flash[key] = this.#attributes[key];
    }
    this.#attributes._flash = old.filter((key) => !keepSet.has(key));
    this.#touch();
    return this;
  }

  removeFromOldFlashData(keys: string[]): this {
    const old = (this.#attributes._flash as string[] | undefined) ?? [];
    const remove = new Set(keys);
    this.#attributes._flash = old.filter((key) => !remove.has(key));
    this.#touch();
    return this;
  }

  /**
   * Rotate the session id.
   * Middleware applies the new id + optional destroy of the old record.
   */
  regenerate(destroy = false): boolean {
    return this.migrate(destroy);
  }

  /** Generate a new session id; optionally destroy the old session record. */
  migrate(destroy = false): boolean {
    if (!this.#id) this.#id = this.generateSessionId();
    this.#previousId = this.#id;
    this.#id = this.generateSessionId();
    this.#pendingRegenerate = true;
    this.#destroyOldOnRegenerate = destroy;
    this.regenerateToken();
    this.#touch();
    return true;
  }

  /** Flush data and regenerate the id. */
  invalidate(): boolean {
    this.flush();
    return this.migrate(true);
  }

  token(): string {
    return String(this.get("_token", ""));
  }

  regenerateToken(): this {
    this.put("_token", this.generateSessionId());
    return this;
  }

  previousUrl(): string | undefined {
    return this.get<string | undefined>("_previous.url");
  }

  previousUri(): string | undefined {
    return this.previousUrl();
  }

  hasPreviousUri(): boolean {
    return typeof this.previousUrl() === "string";
  }

  setPreviousUrl(url: string): this {
    this.put("_previous.url", url);
    return this;
  }

  previousRoute(): string | undefined {
    return this.get<string | undefined>("_previous.route");
  }

  setPreviousRoute(route: string | null): this {
    if (route == null) this.forget("_previous.route");
    else this.put("_previous.route", route);
    return this;
  }

  /** True when password was confirmed within `timeout` seconds (default 3 hours). */
  passwordConfirmed(timeout = 10800): boolean {
    const confirmedAt = this.get<number | undefined>("auth.password_confirmed_at");
    if (confirmedAt == null) return false;
    return Date.now() / 1000 - confirmedAt < timeout;
  }

  /**
   * Consume a pending regenerate for middleware.
   * Returns null when no rotation was requested.
   */
  consumeRegeneration():
    | { newId: string; oldId: string; destroyOld: boolean }
    | null {
    if (!this.#pendingRegenerate || !this.#id || !this.#previousId) return null;
    const result = {
      newId: this.#id,
      oldId: this.#previousId,
      destroyOld: this.#destroyOldOnRegenerate,
    };
    this.#pendingRegenerate = false;
    this.#destroyOldOnRegenerate = false;
    this.#previousId = undefined;
    return result;
  }

  /** Move flash for the next request; drop previous flash keys. */
  ageFlash(): this {
    return this.ageFlashData();
  }

  ageFlashData(): this {
    const previous = (this.#attributes._flash as string[] | undefined) ?? [];
    const nowCount = this.#nowKeys.size;
    const flashCount = Object.keys(this.#flash).length;
    if (previous.length === 0 && nowCount === 0 && flashCount === 0) {
      // Normalize empty flash bag without marking dirty (bootstrap / no-op).
      if (
        !Array.isArray(this.#attributes._flash) ||
        (this.#attributes._flash as unknown[]).length !== 0
      ) {
        this.#attributes._flash = [];
      }
      return this;
    }

    for (const key of previous) {
      // Flashed again during this request — keep the new value for the next one.
      if (key in this.#flash) continue;
      delete this.#attributes[key];
    }
    for (const key of this.#nowKeys) {
      delete this.#attributes[key];
    }
    this.#nowKeys.clear();
    const keys = Object.keys(this.#flash);
    this.#attributes._flash = keys;
    this.#flash = {};
    this.#touch();
    return this;
  }

  /** Persist flash aging; optional save callback writes the store. */
  async save(): Promise<void> {
    this.ageFlashData();
    if (this.#saveCallback) await this.#saveCallback(this);
  }

  /** Live a persistence callback used by `save()`. */
  setSaveCallback(
    callback: ((session: Session) => void | Promise<void>) | undefined,
  ): this {
    this.#saveCallback = callback;
    return this;
  }

  getHandler(): SessionHandler | undefined {
    return this.#handler;
  }

  setHandler(handler: SessionHandler | undefined): this {
    this.#handler = handler;
    return this;
  }

  toJSON(): Record<string, unknown> {
    return this.#attributes;
  }
}

/** Minimal handler surface for store adapters (optional). */
export type SessionHandler = {
  read?(id: string): string | Promise<string>;
  write?(id: string, data: string): void | Promise<void>;
  destroy?(id: string): void | Promise<void>;
};
