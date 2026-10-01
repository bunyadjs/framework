import { RedisClient } from "bun";
import type { SessionStore } from "@bunyad/contracts";

export type RedisSessionStoreOptions = {
  /** Redis URL, e.g. `redis://127.0.0.1:6379`. */
  url?: string;
  /** Key prefix (Laravel session redis prefix). */
  prefix?: string;
  /**
   * Session lifetime in minutes (Laravel `lifetime`).
   * Applied as Redis key TTL on write.
   */
  lifetime?: number;
  /** Inject a client (tests / custom). */
  client?: RedisClient;
};

/**
 * Laravel `redis` session driver via Bun's `RedisClient`.
 */
export class RedisSessionStore implements SessionStore {
  readonly #prefix: string;
  readonly #lifetimeSeconds: number;
  readonly #client: RedisClient;
  readonly #ownsClient: boolean;

  constructor(options: RedisSessionStoreOptions = {}) {
    this.#prefix = options.prefix ?? "bunyad_session:";
    this.#lifetimeSeconds = (options.lifetime ?? 120) * 60;
    if (options.client) {
      this.#client = options.client;
      this.#ownsClient = false;
    } else {
      this.#client = new RedisClient(options.url);
      this.#ownsClient = true;
    }
  }

  #key(id: string): string {
    return `${this.#prefix}${id}`;
  }

  async read(id: string): Promise<Record<string, unknown> | undefined> {
    const raw = await this.#client.get(this.#key(id));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  async write(id: string, data: Record<string, unknown>): Promise<void> {
    const key = this.#key(id);
    await this.#client.set(key, JSON.stringify(data));
    await this.#client.expire(key, this.#lifetimeSeconds);
  }

  async destroy(id: string): Promise<void> {
    await this.#client.del(this.#key(id));
  }

  close(): void {
    if (this.#ownsClient) this.#client.close();
  }
}
