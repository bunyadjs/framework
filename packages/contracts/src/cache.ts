/**
 * Cache store contract.
 */
export interface CacheStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown, seconds?: number): Promise<void>;
  forever(key: string, value: unknown): Promise<void>;
  forget(key: string): Promise<boolean>;
  flush(): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Atomically bump a numeric value; creates the key at `value` when missing. */
  increment(key: string, value?: number): Promise<number>;
  /** Atomically lower a numeric value; creates the key at `-value` when missing. */
  decrement(key: string, value?: number): Promise<number>;
  /** Store a value only when the key is missing. Optional: stores without it fall back to has + put. */
  add?(key: string, value: unknown, seconds?: number): Promise<boolean>;
}
