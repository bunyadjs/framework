import { Collection, collect, dataGet } from "@bunyad/common";

/**
 * Config repository (`Config.get` / `config()`).
 */
export class ConfigRepository {
  #items: Record<string, unknown>;

  constructor(items: Record<string, unknown> = {}) {
    this.#items = items;
  }

  all(): Record<string, unknown> {
    return this.#items;
  }

  get<T = unknown>(key: string, defaultValue?: T): T {
    const value = dataGet(this.#items, key);
    return (value === undefined ? defaultValue : value) as T;
  }

  /** Laravel `Config::getMany`. */
  getMany(keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = this.get(key);
    }
    return out;
  }

  set(key: string, value: unknown): void {
    const parts = key.split(".");
    let cursor: Record<string, unknown> = this.#items;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      const next = cursor[part];
      if (typeof next !== "object" || next === null) {
        cursor[part] = {};
      }
      cursor = cursor[part] as Record<string, unknown>;
    }

    cursor[parts[parts.length - 1]!] = value;
  }

  has(key: string): boolean {
    return dataGet(this.#items, key) !== undefined;
  }

  string(key: string, defaultValue = ""): string {
    const value = this.get(key, defaultValue);
    return value === undefined || value === null ? defaultValue : String(value);
  }

  integer(key: string, defaultValue = 0): number {
    const value = this.get(key);
    if (value === undefined || value === null || value === "") return defaultValue;
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : defaultValue;
  }

  float(key: string, defaultValue = 0): number {
    const value = this.get(key);
    if (value === undefined || value === null || value === "") return defaultValue;
    const n = Number.parseFloat(String(value));
    return Number.isFinite(n) ? n : defaultValue;
  }

  boolean(key: string, defaultValue = false): boolean {
    const value = this.get(key);
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const s = String(value).toLowerCase();
    return ["1", "true", "on", "yes"].includes(s);
  }

  array(key: string, defaultValue: unknown[] = []): unknown[] {
    const value = this.get(key);
    if (value === undefined || value === null) return defaultValue;
    if (Array.isArray(value)) return value;
    if (typeof value === "object") return Object.values(value as Record<string, unknown>);
    return defaultValue;
  }

  collection(key: string): Collection<unknown> {
    return collect(this.array(key));
  }

  /** Prepend a value onto a config array (Laravel `Config::prepend`). */
  prepend(key: string, value: unknown): void {
    const array = this.array(key);
    this.set(key, [value, ...array]);
  }

  /** Push a value onto a config array (Laravel `Config::push`). */
  push(key: string, value: unknown): void {
    const array = this.array(key);
    this.set(key, [...array, value]);
  }
}

let defaultConfig: ConfigRepository | undefined;

export function setConfigInstance(config: ConfigRepository): void {
  defaultConfig = config;
}

/** `config('app.name')` helper. */
export function config<T = unknown>(key: string, defaultValue?: T): T {
  return defaultConfig!.get(key, defaultValue);
}

/** `Config` facade. */
export const Config = {
  get<T = unknown>(key: string, defaultValue?: T): T {
    return defaultConfig!.get(key, defaultValue);
  },
  getMany(keys: string[]): Record<string, unknown> {
    return defaultConfig!.getMany(keys);
  },
  set(key: string, value: unknown): void {
    defaultConfig!.set(key, value);
  },
  has(key: string): boolean {
    return defaultConfig!.has(key);
  },
  all(): Record<string, unknown> {
    return defaultConfig!.all();
  },
  string(key: string, defaultValue?: string): string {
    return defaultConfig!.string(key, defaultValue);
  },
  integer(key: string, defaultValue?: number): number {
    return defaultConfig!.integer(key, defaultValue);
  },
  float(key: string, defaultValue?: number): number {
    return defaultConfig!.float(key, defaultValue);
  },
  boolean(key: string, defaultValue?: boolean): boolean {
    return defaultConfig!.boolean(key, defaultValue);
  },
  array(key: string, defaultValue?: unknown[]): unknown[] {
    return defaultConfig!.array(key, defaultValue);
  },
  collection(key: string): Collection<unknown> {
    return defaultConfig!.collection(key);
  },
  prepend(key: string, value: unknown): void {
    defaultConfig!.prepend(key, value);
  },
  push(key: string, value: unknown): void {
    defaultConfig!.push(key, value);
  },
};
