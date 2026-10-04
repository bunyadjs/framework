import { dataGet, dataSet } from "./data-get.ts";
import { DdException } from "./dd-exception.ts";

export type CollectionKey = string | number;

type ItemCallback<T, R> = (item: T, index: number) => R;
type ItemPredicate<T> = (item: T, index: number) => boolean;
type KeyRetriever<T> = string | ((item: T) => unknown);

export function valueAt(
  item: unknown,
  key: string | ((item: unknown) => unknown),
): unknown {
  if (typeof key === "function") return key(item);
  if (item == null || typeof item !== "object") return undefined;
  if (key.includes(".")) {
    return dataGet(item as Record<string, unknown>, key);
  }
  return (item as Record<string, unknown>)[key];
}

function isAssocObject(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Collection)
  );
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isAssocObject(val) && !(val instanceof Date)) {
      flattenObject(val, path, out);
    } else {
      out[path] = val;
    }
  }
  return out;
}

function undotObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    dataSet(out, key, val);
  }
  return out;
}

/**
 * Support Collection — iterable list with a fluent transform API.
 *
 * Prefer Collection methods (`map`, `filter`, `pluck`, `each`, …) over
 * converting with `all()` / `toArray()`. Use those only at HTTP / JSON edges
 * that require a plain array.
 */
export class Collection<T = unknown> implements Iterable<T> {
  protected items: T[];

  /**
   * Numeric index access: `$collection[0]` style (shared by ctor / fromOwned).
   * Char-code scan instead of RegExp — cheaper on every method read.
   */
  protected static readonly indexProxy: ProxyHandler<Collection<unknown>> = {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop.length > 0) {
        const c0 = prop.charCodeAt(0);
        if (c0 >= 48 && c0 <= 57) {
          let allDigits = true;
          for (let i = 1; i < prop.length; i++) {
            const c = prop.charCodeAt(i);
            if (c < 48 || c > 57) {
              allDigits = false;
              break;
            }
          }
          // Reject leading-zero multi-digit ("01") — not a canonical index key.
          if (allDigits && (prop.length === 1 || c0 !== 48)) {
            return target.items[Number(prop)];
          }
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  };

  /**
   * Wrap an array the caller already owns — no copy.
   * Prefer this on hydrate / map / filter outputs; public `new Collection(arr)` still copies.
   */
  static fromOwned<T = unknown>(items: T[]): Collection<T> {
    return new Collection<T>(items, { owned: true });
  }

  constructor(
    items: T[] | Collection<T> | Iterable<T> | null | undefined = [],
    options?: { owned?: boolean },
  ) {
    if (options?.owned) {
      this.items = items as T[];
    } else if (items == null) {
      this.items = [];
    } else if (items instanceof Collection) {
      this.items = items.items.slice();
    } else if (Array.isArray(items)) {
      this.items = items.slice();
    } else {
      this.items = [...items];
    }

    return new Proxy(
      this,
      Collection.indexProxy as ProxyHandler<Collection<T>>,
    ) as Collection<T>;
  }

  /** Number of items (also used by `expect(...).toHaveLength`). */
  get length(): number {
    return this.items.length;
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }

  static make<T = unknown>(
    items?: T[] | Collection<T> | Iterable<T> | null,
  ): Collection<T> {
    return new Collection(items);
  }

  static empty<T = unknown>(): Collection<T> {
    return new Collection<T>([]);
  }

  static times<T>(
    count: number,
    callback?: (number: number) => T,
  ): Collection<T> {
    const n = Math.max(0, Math.floor(count));
    if (!callback) {
      return new Collection(
        Array.from({ length: n }, (_, i) => (i + 1) as unknown as T),
      );
    }
    return new Collection(Array.from({ length: n }, (_, i) => callback(i + 1)));
  }

  static range(from: number, to: number): Collection<number> {
    const out: number[] = [];
    if (from <= to) {
      for (let i = from; i <= to; i++) out.push(i);
    } else {
      for (let i = from; i >= to; i--) out.push(i);
    }
    return new Collection(out);
  }

  static wrap<T = unknown>(value: T | T[] | Collection<T> | null | undefined): Collection<T> {
    if (value instanceof Collection) return new Collection<T>(value.all());
    if (value === null || value === undefined) return new Collection<T>([]);
    if (Array.isArray(value)) return new Collection<T>(value);
    return new Collection<T>([value as T]);
  }

  static unwrap<T>(value: T | Collection<T>): T | T[] {
    return value instanceof Collection ? (value.all() as T[]) : value;
  }

  static fromJson<T = unknown>(json: string): Collection<T> {
    const parsed = JSON.parse(json) as T[] | Record<string, T>;
    if (Array.isArray(parsed)) return new Collection(parsed);
    return new Collection(Object.values(parsed));
  }

  /**
   * Underlying items (`Collection::all()`).
   * Returns the live array — mutating it mutates the collection.
   * Copy explicitly when you need isolation (`[...c.all()]` / `c.all().slice()`).
   */
  all(): T[] {
    return this.items;
  }

  /** Alias of {@link all} for Support Collection. */
  toArray(): T[] {
    return this.all();
  }

  toJSON(): T[] {
    return this.items.map((item) => {
      if (item && typeof item === "object") {
        const maybe = item as unknown as { toJSON?: () => unknown };
        if (typeof maybe.toJSON === "function") {
          return maybe.toJSON() as T;
        }
      }
      return item;
    });
  }

  toJson(flags?: number): string {
    void flags;
    return JSON.stringify(this.toJSON());
  }

  toPrettyJson(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  toBase(): Collection<T> {
    return new Collection(this.items);
  }

  collect(): Collection<T> {
    return new Collection(this.items);
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  isNotEmpty(): boolean {
    return !this.isEmpty();
  }

  count(): number {
    return this.items.length;
  }

  containsOneItem(callback?: ItemPredicate<T>): boolean {
    if (!callback) return this.items.length === 1;
    return this.filter(callback).count() === 1;
  }

  containsManyItems(callback?: ItemPredicate<T>): boolean {
    if (!callback) return this.items.length > 1;
    return this.filter(callback).count() > 1;
  }

  add(item: T): this {
    this.items.push(item);
    return this;
  }

  first(callback?: ItemPredicate<T>, defaultValue: T | null = null): T | null {
    if (!callback) {
      return this.items[0] ?? defaultValue;
    }
    for (let i = 0; i < this.items.length; i++) {
      if (callback(this.items[i]!, i)) return this.items[i]!;
    }
    return defaultValue;
  }

  firstOrFail(callback?: ItemPredicate<T>): T {
    const item = this.first(callback);
    if (item === null || item === undefined) {
      throw new Error("Item not found.");
    }
    return item;
  }

  firstWhere(key: KeyRetriever<T>, operator?: unknown, value?: unknown): T | null {
    return this.where(key as string, operator, value).first();
  }

  last(callback?: ItemPredicate<T>, defaultValue: T | null = null): T | null {
    if (!callback) {
      return this.items[this.items.length - 1] ?? defaultValue;
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (callback(this.items[i]!, i)) return this.items[i]!;
    }
    return defaultValue;
  }

  sole(callback?: ItemPredicate<T>): T {
    const filtered = callback ? this.filter(callback) : this;
    if (filtered.count() === 0) throw new Error("Item not found.");
    if (filtered.count() > 1) throw new Error("Multiple items found.");
    return filtered.first()!;
  }

  value(key?: KeyRetriever<T>, defaultValue: unknown = null): unknown {
    if (key === undefined) return this.first() ?? defaultValue;
    const first = this.first();
    if (first == null) return defaultValue;
    return valueAt(first, key as string | ((i: unknown) => unknown)) ?? defaultValue;
  }

  get(key: CollectionKey, defaultValue: T | null = null): T | null {
    const index = typeof key === "number" ? key : Number(key);
    if (Number.isInteger(index) && index >= 0 && index < this.items.length) {
      return this.items[index] ?? defaultValue;
    }
    return defaultValue;
  }

  getOrPut(key: number, value: T | (() => T)): T {
    const existing = this.get(key);
    if (existing !== null && existing !== undefined) return existing;
    const resolved = typeof value === "function" ? (value as () => T)() : value;
    this.put(key, resolved);
    return resolved;
  }

  put(key: number, value: T): this {
    this.items[key] = value;
    return this;
  }

  pull(key: CollectionKey, defaultValue: T | null = null): T | null {
    const index = typeof key === "number" ? key : Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      return defaultValue;
    }
    const [removed] = this.items.splice(index, 1);
    return removed ?? defaultValue;
  }

  push(...values: T[]): this {
    this.items.push(...values);
    return this;
  }

  pop(count = 1): T | Collection<T> | undefined {
    if (count === 1) return this.items.pop();
    const n = Math.max(0, Math.floor(count));
    return this.make(this.items.splice(Math.max(0, this.items.length - n), n));
  }

  shift(count = 1): T | Collection<T> | undefined {
    if (count === 1) return this.items.shift();
    const n = Math.max(0, Math.floor(count));
    return this.make(this.items.splice(0, n));
  }

  prepend(value: T): this {
    this.items.unshift(value);
    return this;
  }

  unshift(...values: T[]): this {
    this.items.unshift(...values);
    return this;
  }

  forget(...keys: CollectionKey[]): this {
    const remove = new Set(keys.map((k) => (typeof k === "number" ? k : Number(k))));
    this.items = this.items.filter((_, i) => !remove.has(i));
    return this;
  }

  has(...keys: CollectionKey[]): boolean {
    return keys.every((key) => {
      const index = typeof key === "number" ? key : Number(key);
      return Number.isInteger(index) && index >= 0 && index < this.items.length;
    });
  }

  hasAny(...keys: CollectionKey[]): boolean {
    return keys.some((key) => this.has(key));
  }

  hasMany(...keys: CollectionKey[]): boolean {
    return keys.filter((key) => this.has(key)).length > 1;
  }

  hasSole(...keys: CollectionKey[]): boolean {
    return keys.filter((key) => this.has(key)).length === 1;
  }

  map<U>(callback: ItemCallback<T, U>): Collection<U> {
    return new Collection(this.items.map(callback));
  }

  mapInto<U>(ctor: new (item: T) => U): Collection<U> {
    return this.map((item) => new ctor(item));
  }

  mapWithKeys<U>(
    callback: (item: T, index: number) => Record<string, U> | [CollectionKey, U],
  ): Collection<U> {
    const out: U[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const result = callback(this.items[i]!, i);
      if (Array.isArray(result)) {
        out.push(result[1]);
      } else {
        out.push(...Object.values(result));
      }
    }
    return new Collection(out);
  }

  mapToDictionary(
    callback: (item: T, index: number) => Record<string, unknown> | [CollectionKey, unknown],
  ): Collection<unknown[]> {
    const dict = new Map<string, unknown[]>();
    for (let i = 0; i < this.items.length; i++) {
      const result = callback(this.items[i]!, i);
      let key: string;
      let val: unknown;
      if (Array.isArray(result)) {
        key = String(result[0]);
        val = result[1];
      } else {
        const entries = Object.entries(result);
        if (entries.length === 0) continue;
        key = String(entries[0]![0]);
        val = entries[0]![1];
      }
      const list = dict.get(key) ?? [];
      list.push(val);
      dict.set(key, list);
    }
    return new Collection([...dict.values()]);
  }

  mapToGroups(
    callback: (item: T, index: number) => Record<string, unknown> | [CollectionKey, unknown],
  ): Collection<Collection<unknown>> {
    return this.mapToDictionary(callback).map((list) => new Collection(list as unknown[]));
  }

  mapSpread<U>(callback: (...chunk: unknown[]) => U): Collection<U> {
    return this.map((item) => {
      const args = Array.isArray(item) ? item : [item];
      return callback(...(args as unknown[]));
    });
  }

  flatMap<U>(callback: ItemCallback<T, U[] | Collection<U>>): Collection<U> {
    const out: U[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const result = callback(this.items[i]!, i);
      if (result instanceof Collection) out.push(...result.all());
      else out.push(...result);
    }
    return new Collection(out);
  }

  each(callback: ItemCallback<T, void | false>): this {
    for (let i = 0; i < this.items.length; i++) {
      if (callback(this.items[i]!, i) === false) break;
    }
    return this;
  }

  /** Array-style alias of {@link each}. */
  forEach(callback: ItemCallback<T, void | false>): this {
    return this.each(callback);
  }

  eachSpread(callback: (...chunk: unknown[]) => void | false): this {
    for (const item of this.items) {
      const args = Array.isArray(item) ? item : [item];
      if (callback(...(args as unknown[])) === false) break;
    }
    return this;
  }

  transform(callback: ItemCallback<T, T>): this {
    this.items = this.items.map(callback);
    return this;
  }

  filter(callback?: ItemPredicate<T>): Collection<T> {
    if (!callback) {
      return this.make(
        this.items.filter((item) => item != null && item !== false),
      );
    }
    return this.make(this.items.filter(callback));
  }

  reject(callback: ItemPredicate<T>): Collection<T> {
    return this.make(this.items.filter((item, i) => !callback(item, i)));
  }

  every(callback: ItemPredicate<T>): boolean {
    return this.items.every(callback);
  }

  some(
    key: T | ItemPredicate<T> | string,
    operator?: unknown,
    value?: unknown,
  ): boolean {
    return this.contains(key, operator, value);
  }

  ensure(
    type: string | (new (...args: never[]) => unknown) | Array<string | (new (...args: never[]) => unknown)>,
  ): this {
    const types = Array.isArray(type) ? type : [type];
    for (const item of this.items) {
      const ok = types.some((t) => {
        if (typeof t === "string") return typeof item === t;
        return item instanceof t;
      });
      if (!ok) {
        throw new Error("Collection items failed type ensure check.");
      }
    }
    return this;
  }

  reduce<U>(callback: (carry: U, item: T, index: number) => U, initial: U): U {
    return this.items.reduce(callback, initial);
  }

  reduceWithKeys<U>(
    callback: (carry: U, item: T, key: number) => U,
    initial: U,
  ): U {
    return this.reduce(callback, initial);
  }

  reduceSpread<U>(
    callback: (carry: U, ...chunk: unknown[]) => U,
    initial: U,
  ): U {
    return this.items.reduce((carry, item) => {
      const args = Array.isArray(item) ? item : [item];
      return callback(carry, ...(args as unknown[]));
    }, initial);
  }

  reduceInto<U extends object>(
    callback: (carry: U, item: T, index: number) => void,
    initial: U,
  ): U {
    for (let i = 0; i < this.items.length; i++) {
      callback(initial, this.items[i]!, i);
    }
    return initial;
  }

  contains(
    key: T | ItemPredicate<T> | string,
    operator?: unknown,
    value?: unknown,
  ): boolean {
    if (typeof key === "function") {
      return this.items.some(key as ItemPredicate<T>);
    }
    if (operator === undefined && value === undefined) {
      return this.items.includes(key as T);
    }
    if (value === undefined) {
      return this.items.some(
        (item) => valueAt(item, key as string) == operator,
      );
    }
    return this.where(key as string, operator as string, value).isNotEmpty();
  }

  containsStrict(key: T | ItemPredicate<T>): boolean {
    if (typeof key === "function") {
      return this.items.some(key as ItemPredicate<T>);
    }
    return this.items.some((item) => item === key);
  }

  doesntContain(
    key: T | ItemPredicate<T> | string,
    operator?: unknown,
    value?: unknown,
  ): boolean {
    return !this.contains(key, operator, value);
  }

  doesntContainStrict(key: T | ItemPredicate<T>): boolean {
    return !this.containsStrict(key);
  }

  /**
   * `Collection::pluck($value, $key = null)`.
   * One argument → list Collection of values.
   * With `keyedBy`, returns a plain object `{ [key]: value }` (PHP associative
   * array / `Arr.pluck` keyed form). Collection remains list-backed, so keyed
   * results are Records rather than a keyed Collection instance. Duplicate keys
   * keep the last value.
   */
  pluck(value: string): Collection<unknown>;
  pluck(value: string, keyedBy: string): Record<string, unknown>;
  pluck(
    value: string,
    keyedBy?: string,
  ): Collection<unknown> | Record<string, unknown> {
    if (keyedBy === undefined) {
      return new Collection(this.items.map((item) => valueAt(item, value)));
    }
    const out: Record<string, unknown> = {};
    for (const item of this.items) {
      out[String(valueAt(item, keyedBy))] = valueAt(item, value);
    }
    return out;
  }

  only(keys: CollectionKey[]): Collection<T> {
    const set = new Set(keys.map(String));
    return this.make(this.items.filter((_, i) => set.has(String(i))));
  }

  except(keys: CollectionKey[]): Collection<T> {
    const set = new Set(keys.map(String));
    return this.make(this.items.filter((_, i) => !set.has(String(i))));
  }

  where(key: KeyRetriever<T>, operator?: unknown, value?: unknown): Collection<T> {
    if (typeof key === "function") {
      return this.filter((item, i) => Boolean(key(item)));
    }
    let op = operator;
    let val = value;
    if (val === undefined) {
      val = op;
      op = "=";
    }
    return this.filter((item) => compare(valueAt(item, key), String(op), val));
  }

  whereStrict(key: string, value: unknown): Collection<T> {
    return this.filter((item) => valueAt(item, key) === value);
  }

  whereIn(key: string, values: unknown[]): Collection<T> {
    const set = new Set(values);
    return this.filter((item) => set.has(valueAt(item, key)));
  }

  whereInStrict(key: string, values: unknown[]): Collection<T> {
    return this.filter((item) => values.some((v) => v === valueAt(item, key)));
  }

  whereNotIn(key: string, values: unknown[]): Collection<T> {
    const set = new Set(values);
    return this.filter((item) => !set.has(valueAt(item, key)));
  }

  whereNotInStrict(key: string, values: unknown[]): Collection<T> {
    return this.filter((item) => !values.some((v) => v === valueAt(item, key)));
  }

  whereBetween(key: string, range: [unknown, unknown]): Collection<T> {
    const [min, max] = range;
    return this.filter((item) => {
      const v = valueAt(item, key) as number;
      return v >= (min as number) && v <= (max as number);
    });
  }

  whereNotBetween(key: string, range: [unknown, unknown]): Collection<T> {
    const [min, max] = range;
    return this.filter((item) => {
      const v = valueAt(item, key) as number;
      return v < (min as number) || v > (max as number);
    });
  }

  whereNull(key?: string): Collection<T> {
    if (key === undefined) {
      return this.filter((item) => item == null);
    }
    return this.filter((item) => valueAt(item, key) == null);
  }

  whereNotNull(key?: string): Collection<T> {
    if (key === undefined) {
      return this.filter((item) => item != null);
    }
    return this.filter((item) => valueAt(item, key) != null);
  }

  whereInstanceOf(ctor: new (...args: never[]) => unknown): Collection<T> {
    return this.filter((item) => item instanceof ctor);
  }

  groupBy(key: KeyRetriever<T>): Collection<Collection<T>> {
    const groups = new Map<string, T[]>();
    for (const item of this.items) {
      const groupKey = String(
        valueAt(item, key as string | ((i: unknown) => unknown)),
      );
      const list = groups.get(groupKey) ?? [];
      list.push(item);
      groups.set(groupKey, list);
    }
    return new Collection([...groups.values()].map((list) => this.make(list)));
  }

  countBy(key?: KeyRetriever<T>): Collection<number> {
    const counts = new Map<string, number>();
    for (const item of this.items) {
      const k =
        key === undefined
          ? String(item)
          : String(valueAt(item, key as string | ((i: unknown) => unknown)));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return new Collection([...counts.values()]);
  }

  keyBy(key: KeyRetriever<T>): Collection<T> {
    const map = new Map<string, T>();
    for (const item of this.items) {
      map.set(
        String(valueAt(item, key as string | ((i: unknown) => unknown))),
        item,
      );
    }
    return this.make([...map.values()]);
  }

  sort(callback?: (a: T, b: T) => number): Collection<T> {
    const sorted = [...this.items];
    if (callback) {
      sorted.sort(callback);
    } else {
      sorted.sort((a, b) => {
        if (a == null && b == null) return 0;
        if (a == null) return -1;
        if (b == null) return 1;
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      });
    }
    return this.make(sorted);
  }

  sortDesc(): Collection<T> {
    return this.sort().reverse();
  }

  sortBy(
    key: KeyRetriever<T> | Array<KeyRetriever<T> | [KeyRetriever<T>, string]>,
    descending = false,
  ): Collection<T> {
    if (Array.isArray(key)) {
      return this.sortByMany(key);
    }
    const sorted = [...this.items].sort((a, b) => {
      const av = valueAt(a, key as string | ((i: unknown) => unknown));
      const bv = valueAt(b, key as string | ((i: unknown) => unknown));
      if (av == null && bv == null) return 0;
      if (av == null) return -1;
      if (bv == null) return 1;
      if (av < bv) return descending ? 1 : -1;
      if (av > bv) return descending ? -1 : 1;
      return 0;
    });
    return this.make(sorted);
  }

  sortByDesc(key: KeyRetriever<T>): Collection<T> {
    return this.sortBy(key, true);
  }

  sortByMany(
    comparisons: Array<KeyRetriever<T> | [KeyRetriever<T>, string]>,
  ): Collection<T> {
    const sorted = [...this.items].sort((a, b) => {
      for (const cmp of comparisons) {
        let key: KeyRetriever<T>;
        let dir = "asc";
        if (Array.isArray(cmp)) {
          key = cmp[0];
          dir = cmp[1] ?? "asc";
        } else {
          key = cmp;
        }
        const av = valueAt(a, key as string | ((i: unknown) => unknown));
        const bv = valueAt(b, key as string | ((i: unknown) => unknown));
        if (av == null && bv == null) continue;
        if (av == null) return dir === "desc" ? 1 : -1;
        if (bv == null) return dir === "desc" ? -1 : 1;
        if (av < bv) return dir === "desc" ? 1 : -1;
        if (av > bv) return dir === "desc" ? -1 : 1;
      }
      return 0;
    });
    return this.make(sorted);
  }

  sortKeys(descending = false): Collection<T> {
    const indexed = this.items.map((item, i) => [i, item] as const);
    indexed.sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]));
    return this.make(indexed.map(([, item]) => item));
  }

  sortKeysDesc(): Collection<T> {
    return this.sortKeys(true);
  }

  sortKeysUsing(callback: (a: number, b: number) => number): Collection<T> {
    const indexed = this.items.map((item, i) => [i, item] as const);
    indexed.sort((a, b) => callback(a[0], b[0]));
    return this.make(indexed.map(([, item]) => item));
  }

  values(): Collection<T> {
    return this.make([...this.items]);
  }

  keys(): Collection<number> {
    return new Collection(this.items.map((_, i) => i));
  }

  unique(key?: KeyRetriever<T>): Collection<T> {
    if (key === undefined) {
      const seen = new Set<unknown>();
      const out: T[] = [];
      for (const item of this.items) {
        if (seen.has(item)) continue;
        seen.add(item);
        out.push(item);
      }
      return this.make(out);
    }
    const seen = new Set<unknown>();
    const out: T[] = [];
    for (const item of this.items) {
      const k = valueAt(item, key as string | ((i: unknown) => unknown));
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
    return this.make(out);
  }

  uniqueStrict(key?: KeyRetriever<T>): Collection<T> {
    return this.unique(key);
  }

  duplicates(key?: KeyRetriever<T>): Collection<T> {
    const counts = new Map<unknown, number>();
    for (const item of this.items) {
      const k =
        key === undefined
          ? item
          : valueAt(item, key as string | ((i: unknown) => unknown));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const out: T[] = [];
    const emitted = new Set<unknown>();
    for (const item of this.items) {
      const k =
        key === undefined
          ? item
          : valueAt(item, key as string | ((i: unknown) => unknown));
      if ((counts.get(k) ?? 0) > 1 && !emitted.has(k)) {
        out.push(item);
        emitted.add(k);
      }
    }
    return this.make(out);
  }

  duplicatesStrict(key?: KeyRetriever<T>): Collection<T> {
    return this.duplicates(key);
  }

  flatten(depth = Infinity): Collection<unknown> {
    const out: unknown[] = [];
    const walk = (list: unknown[], d: number) => {
      for (const item of list) {
        if (d > 0 && (Array.isArray(item) || item instanceof Collection)) {
          walk(item instanceof Collection ? item.all() : item, d - 1);
        } else {
          out.push(item);
        }
      }
    };
    walk(this.items as unknown[], depth);
    return new Collection(out);
  }

  collapse(): Collection<unknown> {
    return this.flatten(1);
  }

  collapseWithKeys(): Collection<unknown> {
    return this.collapse();
  }

  chunk(size: number): Collection<Collection<T>> {
    const n = Math.max(1, Math.floor(size));
    const out: Collection<T>[] = [];
    for (let i = 0; i < this.items.length; i += n) {
      out.push(this.make(this.items.slice(i, i + n)));
    }
    return new Collection(out);
  }

  chunkWhile(callback: ItemPredicate<T>): Collection<Collection<T>> {
    if (this.isEmpty()) return new Collection<Collection<T>>([]);
    const out: Collection<T>[] = [];
    let current: T[] = [this.items[0]!];
    for (let i = 1; i < this.items.length; i++) {
      const item = this.items[i]!;
      if (callback(item, i)) {
        current.push(item);
      } else {
        out.push(this.make(current));
        current = [item];
      }
    }
    out.push(this.make(current));
    return new Collection(out);
  }

  split(numberOfGroups: number): Collection<Collection<T>> {
    const n = Math.max(1, Math.floor(numberOfGroups));
    const size = Math.ceil(this.items.length / n);
    return this.chunk(size).take(n);
  }

  splitIn(numberOfGroups: number): Collection<Collection<T>> {
    return this.split(numberOfGroups);
  }

  concat(items: T[] | Collection<T>): Collection<T> {
    const extra = items instanceof Collection ? items.all() : items;
    return this.make([...this.items, ...extra]);
  }

  merge(items: T[] | Collection<T>): Collection<T> {
    return this.concat(items);
  }

  mergeRecursive(items: T[] | Collection<T> | Record<string, unknown>): Collection<T> {
    if (items instanceof Collection || Array.isArray(items)) {
      return this.merge(items as T[] | Collection<T>);
    }
    if (isAssocObject(items)) {
      const out = this.items.map((item) => {
        if (!isAssocObject(item)) return item;
        return { ...item, ...items } as T;
      });
      return this.make(out);
    }
    return this.make([...this.items]);
  }

  union(items: T[] | Collection<T>): Collection<T> {
    return this.concat(items).unique();
  }

  combine(values: unknown[] | Collection<unknown>): Collection<unknown> {
    const vals = values instanceof Collection ? values.all() : values;
    return new Collection(
      this.items.map((key, i) => [key, vals[i]] as unknown),
    );
  }

  zip(...arrays: Array<unknown[] | Collection<unknown>>): Collection<unknown[]> {
    const lists = arrays.map((a) => (a instanceof Collection ? a.all() : a));
    return new Collection(
      this.items.map((item, i) => [item, ...lists.map((list) => list[i])]),
    );
  }

  crossJoin(...arrays: Array<unknown[] | Collection<unknown>>): Collection<unknown[]> {
    let result: unknown[][] = this.items.map((item) => [item]);
    for (const arr of arrays) {
      const list = arr instanceof Collection ? arr.all() : arr;
      const next: unknown[][] = [];
      for (const row of result) {
        for (const item of list) {
          next.push([...row, item]);
        }
      }
      result = next;
    }
    return new Collection(result);
  }

  diff(items: T[] | Collection<T>): Collection<T> {
    const other = new Set(items instanceof Collection ? items.all() : items);
    return this.make(this.items.filter((item) => !other.has(item)));
  }

  diffUsing(
    items: T[] | Collection<T>,
    callback: (a: T, b: T) => number,
  ): Collection<T> {
    const other = items instanceof Collection ? items.all() : items;
    return this.make(
      this.items.filter(
        (item) => !other.some((o) => callback(item, o) === 0),
      ),
    );
  }

  diffAssoc(items: T[] | Collection<T>): Collection<T> {
    return this.diff(items);
  }

  diffAssocUsing(
    items: T[] | Collection<T>,
    callback: (a: T, b: T) => number,
  ): Collection<T> {
    return this.diffUsing(items, callback);
  }

  diffKeys(items: T[] | Collection<T> | Record<string, unknown>): Collection<T> {
    const otherKeys = new Set<string>();
    if (items instanceof Collection) {
      for (const k of items.keys()) otherKeys.add(String(k));
    } else if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) otherKeys.add(String(i));
    } else {
      for (const k of Object.keys(items)) otherKeys.add(k);
    }
    return this.make(
      this.items.filter((_, i) => !otherKeys.has(String(i))),
    );
  }

  diffKeysUsing(
    items: T[] | Collection<T>,
    callback: (a: string, b: string) => number,
  ): Collection<T> {
    const other = items instanceof Collection ? items.keys().all() : items.map((_, i) => i);
    return this.make(
      this.items.filter((_, i) => {
        const key = String(i);
        return !other.some((o) => callback(key, String(o)) === 0);
      }),
    );
  }

  intersect(items: T[] | Collection<T>): Collection<T> {
    const other = new Set(items instanceof Collection ? items.all() : items);
    return this.make(this.items.filter((item) => other.has(item)));
  }

  intersectUsing(
    items: T[] | Collection<T>,
    callback: (a: T, b: T) => number,
  ): Collection<T> {
    const other = items instanceof Collection ? items.all() : items;
    return this.make(
      this.items.filter((item) => other.some((o) => callback(item, o) === 0)),
    );
  }

  intersectAssoc(items: T[] | Collection<T>): Collection<T> {
    return this.intersect(items);
  }

  intersectAssocUsing(
    items: T[] | Collection<T>,
    callback: (a: T, b: T) => number,
  ): Collection<T> {
    return this.intersectUsing(items, callback);
  }

  intersectByKeys(items: T[] | Collection<T> | Record<string, unknown>): Collection<T> {
    const otherKeys = new Set<string>();
    if (items instanceof Collection) {
      for (const k of items.keys()) otherKeys.add(String(k));
    } else if (Array.isArray(items)) {
      for (let i = 0; i < items.length; i++) otherKeys.add(String(i));
    } else {
      for (const k of Object.keys(items)) otherKeys.add(k);
    }
    return this.make(
      this.items.filter((_, i) => otherKeys.has(String(i))),
    );
  }

  replace(items: T[] | Collection<T>): Collection<T> {
    const extra = items instanceof Collection ? items.all() : items;
    const out = [...this.items];
    for (let i = 0; i < extra.length; i++) {
      out[i] = extra[i]!;
    }
    return this.make(out);
  }

  replaceRecursive(items: T[] | Collection<T>): Collection<T> {
    return this.replace(items);
  }

  reverse(): Collection<T> {
    return this.make([...this.items].reverse());
  }

  flip(): Collection<unknown> {
    return new Collection(
      this.items.map((item, i) => [item, i] as unknown),
    );
  }

  pad(size: number, value: T): Collection<T> {
    const out = [...this.items];
    if (size > 0) {
      while (out.length < size) out.push(value);
    } else {
      const target = Math.abs(size);
      while (out.length < target) out.unshift(value);
    }
    return this.make(out);
  }

  multiply(times: number): Collection<T> {
    const n = Math.max(0, Math.floor(times));
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(...this.items);
    return this.make(out);
  }

  take(limit: number): Collection<T> {
    if (limit < 0) {
      return this.make(this.items.slice(limit));
    }
    return this.make(this.items.slice(0, limit));
  }

  takeUntil(value: T | ItemPredicate<T>): Collection<T> {
    const out: T[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const hit =
        typeof value === "function"
          ? (value as ItemPredicate<T>)(item, i)
          : item === value;
      if (hit) break;
      out.push(item);
    }
    return this.make(out);
  }

  takeWhile(value: T | ItemPredicate<T>): Collection<T> {
    const out: T[] = [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      const ok =
        typeof value === "function"
          ? (value as ItemPredicate<T>)(item, i)
          : item === value;
      if (!ok) break;
      out.push(item);
    }
    return this.make(out);
  }

  skip(count: number): Collection<T> {
    return this.make(this.items.slice(Math.max(0, count)));
  }

  skipUntil(value: T | ItemPredicate<T>): Collection<T> {
    let start = 0;
    for (; start < this.items.length; start++) {
      const item = this.items[start]!;
      const hit =
        typeof value === "function"
          ? (value as ItemPredicate<T>)(item, start)
          : item === value;
      if (hit) break;
    }
    return this.make(this.items.slice(start));
  }

  skipWhile(value: T | ItemPredicate<T>): Collection<T> {
    let start = 0;
    for (; start < this.items.length; start++) {
      const item = this.items[start]!;
      const ok =
        typeof value === "function"
          ? (value as ItemPredicate<T>)(item, start)
          : item === value;
      if (!ok) break;
    }
    return this.make(this.items.slice(start));
  }

  slice(start: number, length?: number): Collection<T> {
    if (length === undefined) return this.make(this.items.slice(start));
    return this.make(this.items.slice(start, start + length));
  }

  splice(offset: number, length?: number, replacement: T[] = []): Collection<T> {
    const items = [...this.items];
    const removed =
      length === undefined
        ? items.splice(offset)
        : items.splice(offset, length, ...replacement);
    this.items = items;
    return this.make(removed);
  }

  nth(step: number, offset = 0): Collection<T> {
    return this.make(
      this.items.filter((_, i) => i >= offset && (i - offset) % step === 0),
    );
  }

  forPage(page: number, perPage: number): Collection<T> {
    const p = Math.max(1, Math.floor(page));
    const n = Math.max(1, Math.floor(perPage));
    return this.slice((p - 1) * n, n);
  }

  /** Sliding windows of `$size` with `$step`. */
  sliding(size: number, step = 1): Collection<Collection<T>> {
    const out: Collection<T>[] = [];
    for (let i = 0; i <= this.items.length - size; i += step) {
      out.push(this.make(this.items.slice(i, i + size)));
    }
    return new Collection(out);
  }

  partition(callback: ItemPredicate<T>): [Collection<T>, Collection<T>] {
    const pass: T[] = [];
    const fail: T[] = [];
    for (let i = 0; i < this.items.length; i++) {
      if (callback(this.items[i]!, i)) pass.push(this.items[i]!);
      else fail.push(this.items[i]!);
    }
    return [this.make(pass), this.make(fail)];
  }

  /** Select given keys from each object item. */
  select(...keys: string[]): Collection<Record<string, unknown>> {
    return new Collection(
      this.items.map((item) => {
        const row: Record<string, unknown> = {};
        for (const key of keys) {
          row[key] = valueAt(item, key);
        }
        return row;
      }),
    );
  }

  search(
    value: T | ItemPredicate<T>,
    strict = false,
  ): number | false {
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i]!;
      if (typeof value === "function") {
        if ((value as ItemPredicate<T>)(item, i)) return i;
      } else if (strict ? item === value : item == value) {
        return i;
      }
    }
    return false;
  }

  after(value: T | ItemPredicate<T>, strict = false): T | null {
    const index = this.search(value as T | ItemPredicate<T>, strict);
    if (index === false) return null;
    return this.items[index + 1] ?? null;
  }

  before(value: T | ItemPredicate<T>, strict = false): T | null {
    const index = this.search(value as T | ItemPredicate<T>, strict);
    if (index === false || index === 0) return null;
    return this.items[index - 1] ?? null;
  }

  random(count?: number): T | Collection<T> | undefined {
    if (this.isEmpty()) return count === undefined ? undefined : this.make([]);
    if (count === undefined) {
      return this.items[Math.floor(Math.random() * this.items.length)];
    }
    const n = Math.max(0, Math.floor(count));
    const copy = [...this.items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return this.make(copy.slice(0, Math.min(n, copy.length)));
  }

  shuffle(): Collection<T> {
    const copy = [...this.items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return this.make(copy);
  }

  implodes(glue: string, key?: string): string {
    if (key === undefined) {
      return this.items.map(String).join(glue);
    }
    return this.items
      .map((item) => String(valueAt(item, key) ?? ""))
      .join(glue);
  }

  /** Alias matching `implode`. */
  implode(glue: string, key?: string): string {
    return this.implodes(glue, key);
  }

  join(glue: string, finalGlue?: string): string {
    if (finalGlue === undefined || this.items.length < 2) {
      return this.items.map(String).join(glue);
    }
    const all = this.items.map(String);
    const last = all.pop()!;
    return `${all.join(glue)}${finalGlue}${last}`;
  }

  average(key?: string | ((item: T) => number)): number | null {
    if (this.isEmpty()) return null;
    const nums = this.items.map((item) => {
      if (key === undefined) return Number(item);
      return Number(valueAt(item, key as string | ((i: unknown) => unknown)));
    });
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  avg(key?: string | ((item: T) => number)): number | null {
    return this.average(key);
  }

  median(key?: string | ((item: T) => number)): number | null {
    if (this.isEmpty()) return null;
    const nums = this.items
      .map((item) => {
        if (key === undefined) return Number(item);
        return Number(valueAt(item, key as string | ((i: unknown) => unknown)));
      })
      .sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    if (nums.length % 2 === 0) {
      return (nums[mid - 1]! + nums[mid]!) / 2;
    }
    return nums[mid]!;
  }

  mode(key?: string | ((item: T) => number)): number[] | null {
    if (this.isEmpty()) return null;
    const counts = new Map<number, number>();
    for (const item of this.items) {
      const n =
        key === undefined
          ? Number(item)
          : Number(valueAt(item, key as string | ((i: unknown) => unknown)));
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    let max = 0;
    for (const c of counts.values()) max = Math.max(max, c);
    return [...counts.entries()]
      .filter(([, c]) => c === max)
      .map(([n]) => n);
  }

  percentage(
    callback: ItemPredicate<T>,
    precision = 2,
  ): number {
    if (this.isEmpty()) return 0;
    const matched = this.filter(callback).count();
    const pct = (matched / this.count()) * 100;
    const factor = 10 ** precision;
    return Math.round(pct * factor) / factor;
  }

  sum(key?: string | ((item: T) => number)): number {
    return this.items.reduce((carry, item) => {
      if (key === undefined) return carry + Number(item);
      return (
        carry + Number(valueAt(item, key as string | ((i: unknown) => unknown)))
      );
    }, 0);
  }

  min(key?: string | ((item: T) => unknown)): unknown {
    if (this.isEmpty()) return null;
    let best: unknown = undefined;
    for (const item of this.items) {
      const v =
        key === undefined
          ? item
          : valueAt(item, key as string | ((i: unknown) => unknown));
      if (best === undefined || (v as number) < (best as number)) best = v;
    }
    return best ?? null;
  }

  max(key?: string | ((item: T) => unknown)): unknown {
    if (this.isEmpty()) return null;
    let best: unknown = undefined;
    for (const item of this.items) {
      const v =
        key === undefined
          ? item
          : valueAt(item, key as string | ((i: unknown) => unknown));
      if (best === undefined || (v as number) > (best as number)) best = v;
    }
    return best ?? null;
  }

  dot(): Collection<unknown> {
    if (this.items.length === 1 && isAssocObject(this.items[0])) {
      return new Collection(Object.values(flattenObject(this.items[0])));
    }
    const out: unknown[] = [];
    for (const item of this.items) {
      if (isAssocObject(item)) {
        out.push(...Object.values(flattenObject(item)));
      } else {
        out.push(item);
      }
    }
    return new Collection(out);
  }

  undot(): Collection<unknown> {
    if (
      this.items.every(
        (item) =>
          Array.isArray(item) && item.length === 2 && typeof item[0] === "string",
      )
    ) {
      const obj: Record<string, unknown> = {};
      for (const item of this.items as unknown as Array<[string, unknown]>) {
        obj[item[0]] = item[1];
      }
      return new Collection<unknown>([undotObject(obj)]);
    }
    return new Collection<unknown>(this.items as unknown[]);
  }

  pipe<U>(callback: (collection: this) => U): U {
    return callback(this);
  }

  pipeInto<U>(ctor: new (items: T[]) => U): U {
    return new ctor(this.all());
  }

  /**
   * Apply a list of transforms. Callback parameter is bivariant so
   * `Collection<Sub>` remains assignable where `Collection<Base>` is expected
   * (OrmCollection / ModelQuery polymorphism).
   */
  pipeThrough(
    callbacks: Array<{
      bivarianceHack(collection: Collection<T>): Collection<T>;
    }["bivarianceHack"]>,
  ): Collection<T> {
    let carry: Collection<T> = this.toBase();
    for (const cb of callbacks) {
      carry = cb(carry);
    }
    return carry;
  }

  tap(callback: (collection: this) => void): this {
    callback(this);
    return this;
  }

  when(
    condition: boolean | ((collection: this) => boolean),
    callback: (collection: this) => unknown,
    defaultCallback?: (collection: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    if (pass) {
      callback(this);
    } else if (defaultCallback) {
      defaultCallback(this);
    }
    return this;
  }

  unless(
    condition: boolean | ((collection: this) => boolean),
    callback: (collection: this) => unknown,
    defaultCallback?: (collection: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    return this.when(!pass, callback, defaultCallback);
  }

  whenEmpty(callback: (collection: this) => unknown, defaultCallback?: (collection: this) => unknown): this {
    return this.when(this.isEmpty(), callback, defaultCallback);
  }

  whenNotEmpty(callback: (collection: this) => unknown, defaultCallback?: (collection: this) => unknown): this {
    return this.when(this.isNotEmpty(), callback, defaultCallback);
  }

  unlessEmpty(callback: (collection: this) => unknown, defaultCallback?: (collection: this) => unknown): this {
    return this.whenNotEmpty(callback, defaultCallback);
  }

  unlessNotEmpty(callback: (collection: this) => unknown, defaultCallback?: (collection: this) => unknown): this {
    return this.whenEmpty(callback, defaultCallback);
  }

  /** Create same runtime class (OrmCollection overrides). Fresh `items` — no copy. */
  protected make(items: T[]): Collection<T> {
    return Collection.fromOwned(items);
  }

  /** Collection `dump()`. */
  dump(): this {
    console.log(this.items);
    return this;
  }

  /** Collection `dd()`. */
  dd(): never {
    this.dump();
    throw new DdException(this.items);
  }
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case "=":
    case "==":
      return left == right;
    case "!=":
    case "<>":
      return left != right;
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    case "<":
      return (left as number) < (right as number);
    case "<=":
      return (left as number) <= (right as number);
    case ">":
      return (left as number) > (right as number);
    case ">=":
      return (left as number) >= (right as number);
    default:
      return left == right;
  }
}

/** `collect($items)`. */
export function collect<T = unknown>(
  items?: T[] | Collection<T> | Iterable<T> | null,
): Collection<T> {
  return new Collection(items);
}
