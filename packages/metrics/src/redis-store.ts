import type { MetricsEntryRecord, MetricsStore, MetricsValueRecord } from "./types.ts";

export type RedisMetricsClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  lpush?(key: string, ...values: string[]): Promise<number>;
  rpop?(key: string): Promise<string | null>;
  llen?(key: string): Promise<number>;
};

export type RedisMetricsStoreOptions = {
  /** Key prefix (default `bunyad:metrics:`). */
  prefix?: string;
  /** Inject a client (tests / custom). */
  client: RedisMetricsClient;
};

/**
 * Redis-backed Metrics store — JSON lists with an in-process read cache.
 */
export class RedisMetricsStore implements MetricsStore {
  readonly #prefix: string;
  readonly #client: RedisMetricsClient;
  #entries: MetricsEntryRecord[] = [];
  #values: MetricsValueRecord[] = [];
  #ready: Promise<void>;

  constructor(options: RedisMetricsStoreOptions) {
    this.#prefix = options.prefix ?? "bunyad:metrics:";
    this.#client = options.client;
    this.#ready = this.refresh();
  }

  #entriesKey(): string {
    return `${this.#prefix}entries`;
  }

  #valuesKey(): string {
    return `${this.#prefix}values`;
  }

  /** Load lists from Redis into the local cache. */
  async refresh(): Promise<void> {
    this.#entries = await this.#readList<MetricsEntryRecord>(this.#entriesKey());
    this.#values = await this.#readList<MetricsValueRecord>(this.#valuesKey());
  }

  async store(
    entries: MetricsEntryRecord[],
    values: MetricsValueRecord[],
  ): Promise<void> {
    await this.#ready;
    if (entries.length > 0) {
      this.#entries.push(...entries);
      await this.#client.set(this.#entriesKey(), JSON.stringify(this.#entries));
    }
    if (values.length > 0) {
      this.#values.push(...values);
      await this.#client.set(this.#valuesKey(), JSON.stringify(this.#values));
    }
  }

  entries(type?: string): MetricsEntryRecord[] {
    if (!type) return [...this.#entries];
    return this.#entries.filter((e) => e.type === type);
  }

  values(type?: string): MetricsValueRecord[] {
    if (!type) return [...this.#values];
    return this.#values.filter((v) => v.type === type);
  }

  flush(): void {
    this.#entries = [];
    this.#values = [];
    void this.#client.del(this.#entriesKey(), this.#valuesKey());
  }

  async #readList<T>(key: string): Promise<T[]> {
    const raw = await this.#client.get(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as T[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
