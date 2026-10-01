/**
 * Prop wrappers matching the Inertia server adapter contract.
 */

export type PropResolver = () => unknown | Promise<unknown>;

export class LazyProp {
  constructor(readonly callback: PropResolver) {}
}

export class AlwaysProp {
  constructor(readonly callback: PropResolver) {}
}

export class OptionalProp {
  constructor(readonly callback: PropResolver) {}
}

export class DeferProp {
  constructor(
    readonly callback: PropResolver,
    readonly group: string | null = null,
  ) {}
}

export function isLazyProp(value: unknown): value is LazyProp {
  return value instanceof LazyProp;
}

export function isAlwaysProp(value: unknown): value is AlwaysProp {
  return value instanceof AlwaysProp;
}

export function isOptionalProp(value: unknown): value is OptionalProp {
  return value instanceof OptionalProp;
}

export function isDeferProp(value: unknown): value is DeferProp {
  return value instanceof DeferProp;
}

export function isDeferredLike(value: unknown): boolean {
  return isLazyProp(value) || isOptionalProp(value) || isDeferProp(value);
}

/**
 * A prop the client merges into what it already has on a partial reload
 * (load more, infinite lists) instead of replacing it.
 */
export class MergeProp {
  /** Append (the default) or prepend arrays. */
  direction: "append" | "prepend" = "append";
  /** Item fields that identify a row, so a reloaded row replaces its old copy. */
  readonly matchKeys: string[] = [];

  constructor(
    readonly callback: PropResolver,
    /** Merge nested objects and arrays all the way down. */
    readonly deep = false,
  ) {}

  append(): this {
    this.direction = "append";
    return this;
  }

  prepend(): this {
    this.direction = "prepend";
    return this;
  }

  /** `Inertia.merge(fn).matchOn("id")`: rows with the same `id` are replaced, not duplicated. */
  matchOn(...keys: string[]): this {
    this.matchKeys.push(...keys);
    return this;
  }
}

/**
 * A prop resolved once and kept by the client across visits (a list of
 * countries, plans); later visits skip it until it expires.
 */
export class OnceProp {
  /** The name the client remembers it by; defaults to the prop's key. */
  key: string | null = null;
  expiresAt: number | null = null;

  constructor(readonly callback: PropResolver) {}

  /** Share the remembered value between pages under one name. */
  as(key: string): this {
    this.key = key;
    return this;
  }

  /** Resolve again after `seconds`, or at a `Date`. */
  until(when: number | Date): this {
    this.expiresAt = when instanceof Date ? when.getTime() : Date.now() + when * 1000;
    return this;
  }
}

/** What `Inertia.scroll` needs from a paginator (`Model.query().paginate()` fits). */
export type ScrollPaginator = {
  readonly currentPage: number;
  hasMorePages(): boolean;
  readonly options?: { pageName?: string };
  toJSON(): unknown;
};

/**
 * A paginated prop for `<InfiniteScroll>`: pages load as the user scrolls and
 * are merged into the list (`data`) the client already has.
 */
export class ScrollProp {
  constructor(
    readonly callback: () => ScrollPaginator | Promise<ScrollPaginator>,
    /** The key inside the paginator's JSON that holds the rows. */
    readonly wrapper = "data",
  ) {}
}

export function isMergeProp(value: unknown): value is MergeProp {
  return value instanceof MergeProp;
}

export function isOnceProp(value: unknown): value is OnceProp {
  return value instanceof OnceProp;
}

export function isScrollProp(value: unknown): value is ScrollProp {
  return value instanceof ScrollProp;
}
