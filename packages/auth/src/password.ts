import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Authenticatable } from "./guard.ts";

/** Status strings match framework password status keys. */
export const RESET_LINK_SENT = "passwords.sent";
export const RESET_THROTTLED = "passwords.throttled";
export const PASSWORD_RESET = "passwords.reset";
export const INVALID_USER = "passwords.user";
export const INVALID_TOKEN = "passwords.token";

export type PasswordCredentials = {
  email: string;
};

export type PasswordResetCredentials = {
  email: string;
  password: string;
  password_confirmation?: string;
  token: string;
};

export type PasswordTokenRepository = {
  /** Create and store a token; returns the plain-text token. */
  create(email: string): Promise<string>;
  exists(email: string, token: string): Promise<boolean>;
  delete(email: string): Promise<void>;
  recentlyCreatedToken(email: string): Promise<boolean>;
};

export type PasswordBrokerOptions = {
  retrieveByCredentials: (
    email: string,
  ) => Authenticatable | null | Promise<Authenticatable | null>;
  /** Build the reset URL for email / notification. */
  createUrl?: (
    email: string,
    token: string,
  ) => string | Promise<string>;
  /** Deliver the reset link (wire Mail / notification here). */
  sendResetNotification?: (
    user: Authenticatable,
    token: string,
    url: string,
  ) => void | Promise<void>;
  tokens?: PasswordTokenRepository;
  /** Token lifetime in minutes (default 60). */
  expire?: number;
  /** Minimum seconds between reset emails (default 60). */
  throttle?: number;
};

type TokenRow = {
  email: string;
  token: string;
  created_at: number;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


function hashTokensEqual(stored: string, plain: string): boolean {
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(hashToken(plain), "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function newPlainToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * In-memory token store (tests / single-process apps).
 */
export class MemoryPasswordTokenRepository implements PasswordTokenRepository {
  readonly #rows = new Map<string, TokenRow>();
  readonly #expireSeconds: number;
  readonly #throttleSeconds: number;

  constructor(expireMinutes = 60, throttleSeconds = 60) {
    this.#expireSeconds = expireMinutes * 60;
    this.#throttleSeconds = throttleSeconds;
  }

  async create(email: string): Promise<string> {
    const plain = newPlainToken();
    this.#rows.set(email.toLowerCase(), {
      email: email.toLowerCase(),
      token: hashToken(plain),
      created_at: Math.floor(Date.now() / 1000),
    });
    return plain;
  }

  async exists(email: string, token: string): Promise<boolean> {
    const row = this.#rows.get(email.toLowerCase());
    if (!row) return false;
    if (Math.floor(Date.now() / 1000) - row.created_at > this.#expireSeconds) {
      this.#rows.delete(email.toLowerCase());
      return false;
    }
    return hashTokensEqual(row.token, token);
  }

  async delete(email: string): Promise<void> {
    this.#rows.delete(email.toLowerCase());
  }

  async recentlyCreatedToken(email: string): Promise<boolean> {
    const row = this.#rows.get(email.toLowerCase());
    if (!row) return false;
    return Math.floor(Date.now() / 1000) - row.created_at < this.#throttleSeconds;
  }
}

/** Minimal DB surface for the database token store. */
export type PasswordTokenConnection = {
  run(sql: string, params?: unknown[]): unknown;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null | Promise<T | null>;
};

export type DatabasePasswordTokenRepositoryOptions = {
  connection: PasswordTokenConnection;
  table?: string;
  expire?: number;
  throttle?: number;
};

/**
 * Database token store (`password_reset_tokens` table).
 *
 * ```sql
 * CREATE TABLE password_reset_tokens (
 *   email TEXT PRIMARY KEY,
 *   token TEXT NOT NULL,
 *   created_at INTEGER NOT NULL
 * );
 * ```
 */
export class DatabasePasswordTokenRepository implements PasswordTokenRepository {
  readonly #db: PasswordTokenConnection;
  readonly #table: string;
  readonly #expireSeconds: number;
  readonly #throttleSeconds: number;

  constructor(options: DatabasePasswordTokenRepositoryOptions) {
    const table = options.table ?? "password_reset_tokens";
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Invalid password reset table [${table}].`);
    }
    this.#db = options.connection;
    this.#table = table;
    this.#expireSeconds = (options.expire ?? 60) * 60;
    this.#throttleSeconds = options.throttle ?? 60;
  }

  async create(email: string): Promise<string> {
    const plain = newPlainToken();
    const key = email.toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    await this.#db.run(`DELETE FROM ${this.#table} WHERE email = ?`, [key]);
    await this.#db.run(
      `INSERT INTO ${this.#table} (email, token, created_at) VALUES (?, ?, ?)`,
      [key, hashToken(plain), now],
    );
    return plain;
  }

  async exists(email: string, token: string): Promise<boolean> {
    const row = await this.#db.get<{ token: string; created_at: number }>(
      `SELECT token, created_at FROM ${this.#table} WHERE email = ?`,
      [email.toLowerCase()],
    );
    if (!row) return false;
    if (Math.floor(Date.now() / 1000) - Number(row.created_at) > this.#expireSeconds) {
      await this.delete(email);
      return false;
    }
    return hashTokensEqual(row.token, token);
  }

  async delete(email: string): Promise<void> {
    await this.#db.run(`DELETE FROM ${this.#table} WHERE email = ?`, [
      email.toLowerCase(),
    ]);
  }

  async recentlyCreatedToken(email: string): Promise<boolean> {
    const row = await this.#db.get<{ created_at: number }>(
      `SELECT created_at FROM ${this.#table} WHERE email = ?`,
      [email.toLowerCase()],
    );
    if (!row) return false;
    return (
      Math.floor(Date.now() / 1000) - Number(row.created_at) < this.#throttleSeconds
    );
  }
}

/**
 * Password broker — `Password.sendResetLink` / `Password.reset`.
 */
export class PasswordBroker {
  readonly #retrieveByCredentials: PasswordBrokerOptions["retrieveByCredentials"];
  readonly #createUrl: PasswordBrokerOptions["createUrl"];
  readonly #sendResetNotification: PasswordBrokerOptions["sendResetNotification"];
  readonly #tokens: PasswordTokenRepository;

  constructor(options: PasswordBrokerOptions) {
    this.#retrieveByCredentials = options.retrieveByCredentials;
    this.#createUrl = options.createUrl;
    this.#sendResetNotification = options.sendResetNotification;
    this.#tokens =
      options.tokens ??
      new MemoryPasswordTokenRepository(options.expire ?? 60, options.throttle ?? 60);
  }

  async sendResetLink(credentials: PasswordCredentials): Promise<string> {
    const email = credentials.email;
    const user = await this.#retrieveByCredentials(email);
    if (!user) return INVALID_USER;

    if (await this.#tokens.recentlyCreatedToken(email)) {
      return RESET_THROTTLED;
    }

    const token = await this.#tokens.create(email);
    const url =
      (await this.#createUrl?.(email, token)) ??
      `/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    await this.#sendResetNotification?.(user, token, url);
    return RESET_LINK_SENT;
  }

  async reset(
    credentials: PasswordResetCredentials,
    callback: (user: Authenticatable, password: string) => void | Promise<void>,
  ): Promise<string> {
    const status = await this.validateReset(credentials);
    if (status !== PASSWORD_RESET) return status;

    const { email, password } = credentials;
    const user = await this.#retrieveByCredentials(email);
    if (!user) return INVALID_USER;

    await callback(user, password);
    await this.#tokens.delete(email);
    return PASSWORD_RESET;
  }

  /**
   * Validate a reset request without applying the new password
   * (Laravel `PasswordBroker::validateReset` — returns status; `PASSWORD_RESET` means ok).
   */
  async validateReset(credentials: PasswordResetCredentials): Promise<string> {
    const user = await this.getUser(credentials);
    if (!user) return INVALID_USER;
    if (!(await this.#tokens.exists(credentials.email, credentials.token))) {
      return INVALID_TOKEN;
    }
    return PASSWORD_RESET;
  }

  /** Resolve user from credentials (Laravel `PasswordBroker::getUser`). */
  async getUser(
    credentials: PasswordCredentials | PasswordResetCredentials,
  ): Promise<Authenticatable | null> {
    return this.#retrieveByCredentials(credentials.email);
  }

  /** Token repository (Laravel `PasswordBroker::getRepository`). */
  getRepository(): PasswordTokenRepository {
    return this.#tokens;
  }

  /** Laravel `Password::tokenExists` / broker token check. */
  async tokenExists(email: string, token: string): Promise<boolean> {
    return this.#tokens.exists(email, token);
  }

  /** Delete stored tokens for an email (Laravel `PasswordBroker::deleteToken`). */
  async deleteToken(user: Authenticatable | string): Promise<void> {
    const email =
      typeof user === "string" ? user : String(user.email ?? "");
    await this.#tokens.delete(email);
  }

  /** Create a new reset token (Laravel `PasswordBroker::createToken`). */
  async createToken(user: Authenticatable | string): Promise<string> {
    const email =
      typeof user === "string" ? user : String(user.email ?? "");
    return this.#tokens.create(email);
  }
}

let defaultBroker: PasswordBroker | undefined;

export function setPasswordBroker(broker: PasswordBroker): void {
  defaultBroker = broker;
}

export function getPasswordBroker(): PasswordBroker {
  return defaultBroker!;
}

/**
 * `Password` facade — status constants + broker methods.
 */
export const Password = {
  ResetLinkSent: RESET_LINK_SENT,
  ResetThrottled: RESET_THROTTLED,
  PasswordReset: PASSWORD_RESET,
  InvalidUser: INVALID_USER,
  InvalidToken: INVALID_TOKEN,
  /** @deprecated Prefer ResetLinkSent */
  RESET_LINK_SENT,
  RESET_THROTTLED,
  PASSWORD_RESET,
  INVALID_USER,
  INVALID_TOKEN,

  sendResetLink(credentials: PasswordCredentials): Promise<string> {
    return getPasswordBroker().sendResetLink(credentials);
  },

  reset(
    credentials: PasswordResetCredentials,
    callback: (user: Authenticatable, password: string) => void | Promise<void>,
  ): Promise<string> {
    return getPasswordBroker().reset(credentials, callback);
  },

  tokenExists(email: string, token: string): Promise<boolean> {
    return getPasswordBroker().tokenExists(email, token);
  },

  createToken(user: Authenticatable | string): Promise<string> {
    return getPasswordBroker().createToken(user);
  },

  deleteToken(user: Authenticatable | string): Promise<void> {
    return getPasswordBroker().deleteToken(user);
  },

  validateReset(credentials: PasswordResetCredentials): Promise<string> {
    return getPasswordBroker().validateReset(credentials);
  },

  getUser(
    credentials: PasswordCredentials | PasswordResetCredentials,
  ): Promise<Authenticatable | null> {
    return getPasswordBroker().getUser(credentials);
  },

  getRepository(): PasswordTokenRepository {
    return getPasswordBroker().getRepository();
  },

  broker(): PasswordBroker {
    return getPasswordBroker();
  },
};
