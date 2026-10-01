import { dataForget, dataGet, dataSet } from "./data-get.ts";

/**
 * Laravel `Illuminate\Support\Arr` — static array/object helpers.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export const Arr = {
  /** Laravel `Arr::accessible`. */
  accessible(value: unknown): value is unknown[] | Record<string, unknown> {
    return Array.isArray(value) || isObject(value);
  },

  /** Laravel `Arr::exists`. */
  exists(array: unknown, key: string | number): boolean {
    if (Array.isArray(array)) {
      return Object.prototype.hasOwnProperty.call(array, key);
    }
    if (!isObject(array)) return false;
    return Object.prototype.hasOwnProperty.call(array, key);
  },

  get<T = unknown>(
    array: unknown,
    key: string | number | null,
    defaultValue?: T,
  ): T {
    if (key === null || key === undefined) return array as T;
    return dataGet(array, String(key), defaultValue) as T;
  },

  set(
    array: Record<string, unknown>,
    key: string,
    value: unknown,
  ): Record<string, unknown> {
    dataSet(array, key, value);
    return array;
  },

  has(array: unknown, keys: string | string[]): boolean {
    const list = Array.isArray(keys) ? keys : [keys];
    return list.every((key) => dataGet(array, key) !== undefined);
  },

  forget(array: Record<string, unknown>, keys: string | string[]): void {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) dataForget(array, key);
  },

  only<T extends Record<string, unknown>>(
    array: T,
    keys: string[],
  ): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(array, key)) {
        out[key] = array[key];
      }
    }
    return out as Partial<T>;
  },

  except<T extends Record<string, unknown>>(
    array: T,
    keys: string[],
  ): Partial<T> {
    const skip = new Set(keys);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(array)) {
      if (!skip.has(key)) out[key] = value;
    }
    return out as Partial<T>;
  },

  first<T>(
    array: T[],
    callback?: (value: T, index: number) => boolean,
    defaultValue?: T,
  ): T | undefined {
    if (!callback) return array[0] ?? defaultValue;
    for (let i = 0; i < array.length; i++) {
      if (callback(array[i]!, i)) return array[i];
    }
    return defaultValue;
  },

  last<T>(
    array: T[],
    callback?: (value: T, index: number) => boolean,
    defaultValue?: T,
  ): T | undefined {
    if (!callback) return array[array.length - 1] ?? defaultValue;
    for (let i = array.length - 1; i >= 0; i--) {
      if (callback(array[i]!, i)) return array[i];
    }
    return defaultValue;
  },

  wrap<T>(value: T | T[] | null | undefined): T[] {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  },

  flatten(array: unknown[], depth = Infinity): unknown[] {
    const out: unknown[] = [];
    const walk = (items: unknown[], d: number) => {
      for (const item of items) {
        if (Array.isArray(item) && d > 0) walk(item, d - 1);
        else out.push(item);
      }
    };
    walk(array, depth);
    return out;
  },

  /** Laravel `Arr::dot`. */
  dot(
    array: Record<string, unknown>,
    prepend = "",
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(array)) {
      const path = prepend ? `${prepend}.${key}` : key;
      if (isObject(value) && !Array.isArray(value) && !(value instanceof Date)) {
        Object.assign(out, Arr.dot(value, path));
      } else {
        out[path] = value;
      }
    }
    return out;
  },

  /** Laravel `Arr::undot`. */
  undot(array: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(array)) {
      dataSet(out, key, value);
    }
    return out;
  },

  pluck<T = unknown>(
    array: Array<Record<string, unknown>>,
    value: string,
    key?: string,
  ): T[] | Record<string, T> {
    if (key === undefined) {
      return array.map((row) => dataGet(row, value) as T);
    }
    const out: Record<string, T> = {};
    for (const row of array) {
      const k = String(dataGet(row, key));
      out[k] = dataGet(row, value) as T;
    }
    return out;
  },

  where<T>(
    array: T[],
    callback: (value: T, index: number) => boolean,
  ): T[] {
    return array.filter(callback);
  },

  whereNotNull<T>(array: Array<T | null | undefined>): T[] {
    return array.filter((v): v is T => v !== null && v !== undefined);
  },

  /** Laravel `Arr::add` — set only if missing. */
  add<T extends Record<string, unknown>>(
    array: T,
    key: string,
    value: unknown,
  ): T {
    if (dataGet(array, key) === undefined) dataSet(array, key, value);
    return array;
  },

  prepend<T>(array: T[], value: T, key?: string | number): T[] | Record<string, unknown> {
    if (key === undefined) {
      array.unshift(value);
      return array;
    }
    return { [key]: value, ...Object.fromEntries(array.entries()) };
  },

  pull<T = unknown>(
    array: Record<string, unknown>,
    key: string,
    defaultValue?: T,
  ): T {
    const value = dataGet(array, key, defaultValue) as T;
    dataForget(array, key);
    return value;
  },

  isAssoc(array: unknown): boolean {
    if (!Array.isArray(array)) return isObject(array);
    return array.some((_, i) => !Object.prototype.hasOwnProperty.call(array, i));
  },

  isList(array: unknown): boolean {
    return Array.isArray(array);
  },

  collapse<T>(array: T[][]): T[] {
    return array.flat();
  },

  join(array: unknown[], glue: string, finalGlue?: string): string {
    const parts = array.map(String);
    if (finalGlue === undefined || parts.length < 2) return parts.join(glue);
    return parts.slice(0, -1).join(glue) + finalGlue + parts[parts.length - 1];
  },

  random<T>(array: T[], number?: number): T | T[] {
    if (number === undefined) {
      return array[Math.floor(Math.random() * array.length)]!;
    }
    const copy = [...array];
    const out: T[] = [];
    for (let i = 0; i < Math.min(number, copy.length); i++) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]!);
    }
    return out;
  },

  /** Laravel `Arr::query` — URL query string. */
  query(array: Record<string, unknown>): string {
    const params = new URLSearchParams();
    const walk = (obj: Record<string, unknown>, prefix?: string) => {
      for (const [key, value] of Object.entries(obj)) {
        const name = prefix ? `${prefix}[${key}]` : key;
        if (value != null && typeof value === "object" && !Array.isArray(value)) {
          walk(value as Record<string, unknown>, name);
        } else if (Array.isArray(value)) {
          for (const item of value) params.append(`${name}[]`, String(item));
        } else if (value !== undefined && value !== null) {
          params.append(name, String(value));
        }
      }
    };
    walk(array);
    return params.toString();
  },

  map<T, R>(
    array: T[] | Record<string, T>,
    callback: (value: T, key: string | number) => R,
  ): R[] {
    if (Array.isArray(array)) {
      return array.map((v, i) => callback(v, i));
    }
    return Object.entries(array).map(([k, v]) => callback(v, k));
  },
};
