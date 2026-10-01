import { RedisClient } from "bun";
import type { JobPayload, QueueDriver } from "@bunyad/contracts";

export type RedisQueueDriverOptions = {
  url?: string;
  prefix?: string;
  client?: RedisClient;
};

/**
 * Redis list-based queue (`LPUSH` / `RPOP`).
 * Delayed jobs use a sorted set (`ZADD` by `availableAt`) until ready.
 */
export class RedisQueueDriver implements QueueDriver {
  readonly serializes = true;
  readonly #prefix: string;
  readonly #client: RedisClient;
  readonly #ownsClient: boolean;

  constructor(options: RedisQueueDriverOptions = {}) {
    this.#prefix = options.prefix ?? "bunyad:queues:";
    if (options.client) {
      this.#client = options.client;
      this.#ownsClient = false;
    } else {
      this.#client = new RedisClient(options.url);
      this.#ownsClient = true;
    }
  }

  #key(queue: string): string {
    return `${this.#prefix}${queue}`;
  }

  #delayedKey(queue: string): string {
    return `${this.#prefix}${queue}:delayed`;
  }

  async push(queue: string, payload: JobPayload): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const raw = JSON.stringify(payload);
    if (payload.availableAt !== undefined && payload.availableAt > now) {
      await this.#client.zadd(
        this.#delayedKey(queue),
        payload.availableAt,
        raw,
      );
      return;
    }
    await this.#client.lpush(this.#key(queue), raw);
  }

  async #promoteDelayed(queue: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const ready = (await this.#client.zrangebyscore(
      this.#delayedKey(queue),
      0,
      now,
    )) as string[];
    if (!ready || ready.length === 0) return;

    for (const raw of ready) {
      await this.#client.zrem(this.#delayedKey(queue), raw);
      await this.#client.lpush(this.#key(queue), raw);
    }
  }

  async pop(queue: string): Promise<JobPayload | undefined> {
    await this.#promoteDelayed(queue);
    const raw = await this.#client.rpop(this.#key(queue));
    if (raw == null) return undefined;
    return JSON.parse(raw) as JobPayload;
  }

  async size(queue: string): Promise<number> {
    const ready = await this.#client.llen(this.#key(queue));
    const delayed = await this.#client.zcard(this.#delayedKey(queue));
    return ready + delayed;
  }

  close(): void {
    if (this.#ownsClient) this.#client.close();
  }
}
