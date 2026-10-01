import type { SessionStore } from "@bunyad/contracts";
import { MemorySessionStore } from "./memory-store.ts";
import { Session } from "./session.ts";

export type SessionDriverFactory = (
  config?: Record<string, unknown>,
) => SessionStore;

export type SessionManagerOptions = {
  default?: string;
  stores?: Record<string, SessionStore>;
};

/**
 * Session driver manager (`Session` facade driver resolution).
 */
export class SessionManager {
  #default: string;
  readonly #drivers = new Map<string, SessionStore>();
  readonly #custom = new Map<string, SessionDriverFactory>();
  #config: Record<string, unknown> = {};

  constructor(options: SessionManagerOptions = {}) {
    this.#default = options.default ?? "memory";
    for (const [name, store] of Object.entries(options.stores ?? {})) {
      this.#drivers.set(name, store);
    }
  }

  driver(name = this.#default): SessionStore {
    const existing = this.#drivers.get(name);
    if (existing) return existing;

    const custom = this.#custom.get(name);
    if (custom) {
      const created = custom();
      this.#drivers.set(name, created);
      return created;
    }

    if (name === "array" || name === "memory") {
      const created = new MemorySessionStore();
      this.#drivers.set(name, created);
      return created;
    }

    throw new Error(`Session driver [${name}] is not configured.`);
  }

  getDefaultDriver(): string {
    return this.#default;
  }

  setDefaultDriver(name: string): this {
    this.#default = name;
    return this;
  }

  getDrivers(): Record<string, SessionStore> {
    return Object.fromEntries(this.#drivers);
  }

  extend(driver: string, callback: SessionDriverFactory): this {
    this.#custom.set(driver, callback);
    return this;
  }

  forgetDrivers(): this {
    this.#drivers.clear();
    return this;
  }

  getSessionConfig(): Record<string, unknown> {
    return { ...this.#config };
  }

  setSessionConfig(config: Record<string, unknown>): this {
    this.#config = { ...config };
    return this;
  }

  /** Start a new in-memory session bag (tests / manual use). */
  start(attributes: Record<string, unknown> = {}): Session {
    const session = new Session(attributes);
    session.setId(session.generateSessionId());
    session.start();
    return session;
  }
}
