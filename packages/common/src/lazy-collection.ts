import { Collection, valueAt } from "./collection.ts";

type MaybePromise<T> = T | Promise<T>;
type Source<T> = AsyncIterable<T> | Iterable<T>;
type Factory<T> = () => Source<T>;
type Callback<T, R> = (item: T, index: number) => MaybePromise<R>;
type Retriever<T> = string | ((item: T) => unknown);

/**
 * Async counterpart of Laravel's `LazyCollection`: a fluent pipeline over a
 * source that is pulled one item at a time, so it can sit on top of a database
 * cursor without loading the table.
 *
 * - Transforming methods (`map`, `filter`, `take`, `chunk`, …) are lazy and
 *   return another `LazyCollection`; callbacks may be async.
 * - Terminal methods (`each`, `first`, `reduce`, `toArray`, …) return a
 *   `Promise` and consume the source. Stopping early (`take`, `first`,
 *   returning `false` from `each`) releases the underlying cursor.
 * - The source is a factory, so iterating twice re-runs it (for a query that
 *   means re-running the query), like Laravel.
 *
 * ```ts
 * const names = await User.cursor().filter((u) => u.active).map((u) => u.name).take(10).toArray();
 * ```
 */
export class LazyCollection<T = unknown> implements AsyncIterable<T> {
  readonly #source: Factory<T>;

  constructor(source: Source<T> | Factory<T>) {
    this.#source =
      typeof source === "function"
        ? (source as Factory<T>)
        : () => source as Source<T>;
  }

  static make<T>(source: Source<T> | Factory<T>): LazyCollection<T> {
    return new LazyCollection(source);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const source = this.#source;
    return (async function* () {
      yield* source();
    })();
  }

  // ---- lazy transforms -------------------------------------------------

  map<R>(callback: Callback<T, R>): LazyCollection<R> {
    const items = this;
    return new LazyCollection<R>(async function* () {
      let index = 0;
      for await (const item of items) yield await callback(item, index++);
    });
  }

  filter(
    callback: Callback<T, unknown> = (item) => Boolean(item),
  ): LazyCollection<T> {
    const items = this;
    return new LazyCollection<T>(async function* () {
      let index = 0;
      for await (const item of items) {
        if (await callback(item, index++)) yield item;
      }
    });
  }

  reject(callback: Callback<T, unknown>): LazyCollection<T> {
    return this.filter(async (item, index) => !(await callback(item, index)));
  }

  flatMap<R>(
    callback: Callback<T, Iterable<R> | AsyncIterable<R>>,
  ): LazyCollection<R> {
    const items = this;
    return new LazyCollection<R>(async function* () {
      let index = 0;
      for await (const item of items) yield* await callback(item, index++);
    });
  }

  /** Run a callback for each item as it passes through, without consuming it. */
  tap(callback: Callback<T, unknown>): LazyCollection<T> {
    const items = this;
    return new LazyCollection<T>(async function* () {
      let index = 0;
      for await (const item of items) {
        await callback(item, index++);
        yield item;
      }
    });
  }

  take(limit: number): LazyCollection<T> {
    const items = this;
    return new LazyCollection<T>(async function* () {
      if (limit <= 0) return;
      let taken = 0;
      for await (const item of items) {
        yield item;
        if (++taken >= limit) return;
      }
    });
  }

  skip(count: number): LazyCollection<T> {
    const items = this;
    return new LazyCollection<T>(async function* () {
      let skipped = 0;
      for await (const item of items) {
        if (skipped++ < count) continue;
        yield item;
      }
    });
  }

  takeWhile(callback: Callback<T, unknown>): LazyCollection<T> {
    const items = this;
    return new LazyCollection<T>(async function* () {
      let index = 0;
      for await (const item of items) {
        if (!(await callback(item, index++))) return;
        yield item;
      }
    });
  }

  takeUntil(callback: Callback<T, unknown>): LazyCollection<T> {
    return this.takeWhile(async (item, index) => !(await callback(item, index)));
  }

  skipWhile(callback: Callback<T, unknown>): LazyCollection<T> {
    const items = this;
    return new LazyCollection<T>(async function* () {
      let index = 0;
      let skipping = true;
      for await (const item of items) {
        if (skipping && (await callback(item, index++))) continue;
        skipping = false;
        yield item;
      }
    });
  }

  /** Yield `Collection` chunks of `size` items. */
  chunk(size: number): LazyCollection<Collection<T>> {
    const width = Math.max(1, Math.floor(size));
    const items = this;
    return new LazyCollection<Collection<T>>(async function* () {
      let batch: T[] = [];
      for await (const item of items) {
        batch.push(item);
        if (batch.length >= width) {
          yield new Collection(batch);
          batch = [];
        }
      }
      if (batch.length > 0) yield new Collection(batch);
    });
  }

  pluck(value: string): LazyCollection<unknown> {
    return this.map((item) => valueAt(item, value));
  }

  /** Drop repeats (by value, or by `key`); remembers the keys it has seen. */
  unique(key?: Retriever<T>): LazyCollection<T> {
    const items = this;
    return new LazyCollection<T>(async function* () {
      const seen = new Set<unknown>();
      for await (const item of items) {
        const id = key === undefined ? item : valueAt(item, key as never);
        if (seen.has(id)) continue;
        seen.add(id);
        yield item;
      }
    });
  }

  // ---- terminal operations ---------------------------------------------

  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }

  all(): Promise<T[]> {
    return this.toArray();
  }

  /** Load everything into an eager `Collection`. */
  async collect(): Promise<Collection<T>> {
    return new Collection(await this.toArray());
  }

  /** Run `callback` per item; return `false` to stop early. */
  async each(callback: Callback<T, void | boolean>): Promise<void> {
    let index = 0;
    for await (const item of this) {
      if ((await callback(item, index++)) === false) return;
    }
  }

  async first(
    callback?: Callback<T, unknown>,
    defaultValue: T | null = null,
  ): Promise<T | null> {
    let index = 0;
    for await (const item of this) {
      if (!callback || (await callback(item, index++))) return item;
    }
    return defaultValue;
  }

  async last(): Promise<T | null> {
    let last: T | null = null;
    for await (const item of this) last = item;
    return last;
  }

  async count(): Promise<number> {
    let n = 0;
    for await (const _ of this) n++;
    return n;
  }

  async isEmpty(): Promise<boolean> {
    for await (const _ of this) return false;
    return true;
  }

  async isNotEmpty(): Promise<boolean> {
    return !(await this.isEmpty());
  }

  async reduce<R>(
    callback: (carry: R, item: T, index: number) => MaybePromise<R>,
    initial: R,
  ): Promise<R> {
    let carry = initial;
    let index = 0;
    for await (const item of this) carry = await callback(carry, item, index++);
    return carry;
  }

  async sum(key?: Retriever<T>): Promise<number> {
    return this.reduce(
      (total, item) =>
        total + Number(key === undefined ? item : valueAt(item, key as never)),
      0,
    );
  }

  async avg(key?: Retriever<T>): Promise<number | null> {
    let total = 0;
    let n = 0;
    for await (const item of this) {
      total += Number(key === undefined ? item : valueAt(item, key as never));
      n++;
    }
    return n === 0 ? null : total / n;
  }

  async min(key?: Retriever<T>): Promise<number | null> {
    let min: number | null = null;
    for await (const item of this) {
      const v = Number(key === undefined ? item : valueAt(item, key as never));
      if (min === null || v < min) min = v;
    }
    return min;
  }

  async max(key?: Retriever<T>): Promise<number | null> {
    let max: number | null = null;
    for await (const item of this) {
      const v = Number(key === undefined ? item : valueAt(item, key as never));
      if (max === null || v > max) max = v;
    }
    return max;
  }

  async contains(callback: Callback<T, unknown> | T): Promise<boolean> {
    let index = 0;
    for await (const item of this) {
      const hit =
        typeof callback === "function"
          ? await (callback as Callback<T, unknown>)(item, index++)
          : item === callback;
      if (hit) return true;
    }
    return false;
  }

  async every(callback: Callback<T, unknown>): Promise<boolean> {
    let index = 0;
    for await (const item of this) {
      if (!(await callback(item, index++))) return false;
    }
    return true;
  }
}
