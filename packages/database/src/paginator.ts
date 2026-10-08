import {
  getPaginatorRequest,
  type PaginatorRequestLike,
} from "@bunyad/common";

type PathResolver = () => string;
type PageResolver = (pageName: string) => number;
type QueryResolver = () => Record<string, string>;

let pathResolver: PathResolver | undefined;
let pageResolver: PageResolver | undefined;
let queryResolver: QueryResolver | undefined;

function trimTrailingSlash(path: string): string {
  if (path === "/" || path === "") return path;
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function requestPath(request?: PaginatorRequestLike): string {
  const path = request?.urlWithoutQuery() ?? "";
  return path ? trimTrailingSlash(path) : "";
}

function flattenQuery(
  raw: Record<string, string>,
  pageName: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === pageName || value === "") continue;
    out[key] = value;
  }
  return out;
}

function resolvedPath(explicit?: string): string {
  if (explicit) return trimTrailingSlash(explicit);
  if (pathResolver) {
    const value = pathResolver();
    return value ? trimTrailingSlash(value) : "";
  }
  return requestPath(getPaginatorRequest());
}

function resolvedQuery(): Record<string, string> {
  if (queryResolver) return queryResolver();
  return getPaginatorRequest()?.query() ?? {};
}

/**
 * Cursor paginator (`cursorPaginate`) — next/prev cursors, no total count.
 */
export class CursorPaginator<T = unknown> {
  readonly options: {
    path?: string;
    cursorName?: string;
    nextCursor: string | null;
    previousCursor: string | null;
  };

  constructor(
    readonly items: T[],
    readonly perPage: number,
    options: {
      path?: string;
      cursorName?: string;
      nextCursor: string | null;
      previousCursor: string | null;
    },
  ) {
    this.options = { ...options, path: resolvedPath(options.path) };
  }

  nextCursor(): string | null {
    return this.options.nextCursor;
  }

  previousCursor(): string | null {
    return this.options.previousCursor;
  }

  hasMorePages(): boolean {
    return this.options.nextCursor !== null;
  }

  onFirstPage(): boolean {
    return this.options.previousCursor === null;
  }

  toJSON(replacement?: unknown): Record<string, unknown> {
    // `JSON.stringify` calls `toJSON(key)`; only an array replaces the items.
    const data: readonly unknown[] = Array.isArray(replacement) ? replacement : this.items;
    const name = this.options.cursorName ?? "cursor";
    const path = this.options.path ?? "";
    const urlFor = (cursor: string | null) => {
      if (!path || cursor === null) return null;
      const sep = path.includes("?") ? "&" : "?";
      return `${path}${sep}${name}=${encodeURIComponent(cursor)}`;
    };
    return {
      data,
      path,
      per_page: this.perPage,
      next_cursor: this.options.nextCursor,
      next_page_url: urlFor(this.options.nextCursor),
      prev_cursor: this.options.previousCursor,
      prev_page_url: urlFor(this.options.previousCursor),
    };
  }
}

/** Encode order-column values into an opaque cursor string. */
export function encodeCursor(parameters: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(parameters), "utf8").toString("base64url");
}

/** Decode a cursor produced by `encodeCursor`. */
export function decodeCursor(cursor: string): Record<string, unknown> {
  return JSON.parse(
    Buffer.from(cursor, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

/** Shared path / page / query resolvers for paginator URL generation. */
export abstract class AbstractPaginator {
  static currentPathResolver(resolver: PathResolver | null): void {
    pathResolver = resolver ?? undefined;
  }

  static currentPageResolver(resolver: PageResolver | null): void {
    pageResolver = resolver ?? undefined;
  }

  static queryStringResolver(resolver: QueryResolver | null): void {
    queryResolver = resolver ?? undefined;
  }

  static resolveCurrentPath(defaultPath = "/"): string {
    return resolvedPath() || defaultPath;
  }

  static resolveCurrentPage(pageName = "page"): number {
    const raw = pageResolver
      ? pageResolver(pageName)
      : getPaginatorRequest()?.input(pageName);
    const page = Math.floor(Number(raw)) || 1;
    return Math.max(1, page);
  }

  static resolveQueryString(): Record<string, string> {
    return resolvedQuery();
  }

  options: { path: string; pageName: string } = { path: "", pageName: "page" };
  protected queryParams: Record<string, string> = {};

  protected initOptions(options: { path?: string; pageName?: string }): void {
    this.options = {
      path: resolvedPath(options.path),
      pageName: options.pageName ?? "page",
    };
  }

  withPath(path: string): this {
    this.options.path = trimTrailingSlash(path);
    return this;
  }

  withQueryString(): this {
    return this.appends(AbstractPaginator.resolveQueryString());
  }

  appends(
    key: string | Record<string, unknown>,
    value?: unknown,
  ): this {
    if (typeof key === "object") {
      for (const [name, entry] of Object.entries(key)) {
        this.appends(name, entry);
      }
      return this;
    }
    if (key === this.options.pageName || value == null) return this;
    this.queryParams[key] = String(value);
    return this;
  }

  url(page: number): string | null {
    const path = this.options.path;
    if (!path) return null;
    const pageNumber = page <= 0 ? 1 : page;
    const params = {
      ...flattenQuery(this.queryParams, this.options.pageName),
      [this.options.pageName]: String(pageNumber),
    };
    const qs = new URLSearchParams(params).toString();
    const sep = path.includes("?") ? "&" : "?";
    return `${path}${sep}${qs}`;
  }
}

/** Current page from an explicit argument, or from `?page=` on the bound request. */
export function resolvePaginatorPage(
  page?: number | null,
  pageName = "page",
): number {
  if (page !== undefined && page !== null) {
    return Math.max(1, Math.floor(Number(page)) || 1);
  }
  return AbstractPaginator.resolveCurrentPage(pageName);
}

/**
 * Length-aware paginator (`paginate`) — total count, last page, and page links.
 */
export class LengthAwarePaginator<T = unknown> extends AbstractPaginator {
  constructor(
    readonly items: T[],
    readonly total: number,
    readonly perPage: number,
    readonly currentPage: number,
    options: { path?: string; pageName?: string } = {},
  ) {
    super();
    this.initOptions(options);
  }

  lastPage(): number {
    return Math.max(1, Math.ceil(this.total / this.perPage) || 1);
  }

  from(): number | null {
    if (this.total === 0 || this.items.length === 0) return null;
    return (this.currentPage - 1) * this.perPage + 1;
  }

  to(): number | null {
    if (this.total === 0 || this.items.length === 0) return null;
    return (this.currentPage - 1) * this.perPage + this.items.length;
  }

  hasMorePages(): boolean {
    return this.currentPage < this.lastPage();
  }

  meta(): Record<string, unknown> {
    return {
      current_page: this.currentPage,
      from: this.from(),
      last_page: this.lastPage(),
      path: this.options.path,
      per_page: this.perPage,
      to: this.to(),
      total: this.total,
    };
  }

  links(): Record<string, string | null> {
    return {
      first: this.url(1),
      last: this.url(this.lastPage()),
      prev: this.currentPage > 1 ? this.url(this.currentPage - 1) : null,
      next: this.hasMorePages() ? this.url(this.currentPage + 1) : null,
    };
  }

  /** `{ data, links, meta }` — pass `data` to replace raw `items`. */
  toJSON(replacement?: unknown): Record<string, unknown> {
    // `JSON.stringify` calls `toJSON(key)`; only an array replaces the items.
    const data: readonly unknown[] = Array.isArray(replacement) ? replacement : this.items;
    return {
      data,
      links: this.links(),
      meta: this.meta(),
    };
  }
}

/**
 * Simple paginator (`simplePaginate`) — next/prev only, no total count.
 */
export class Paginator<T = unknown> extends AbstractPaginator {
  constructor(
    readonly items: T[],
    readonly perPage: number,
    readonly currentPage: number,
    options: { path?: string; pageName?: string } = {},
  ) {
    super();
    this.initOptions(options);
  }

  hasMorePages(): boolean {
    return this.items.length > this.perPage;
  }

  /** Items for the current page (drops the lookahead row). */
  pageItems(): T[] {
    return this.hasMorePages() ? this.items.slice(0, this.perPage) : this.items;
  }

  links(): Record<string, string | null> {
    return {
      first: this.url(1),
      prev: this.currentPage > 1 ? this.url(this.currentPage - 1) : null,
      next: this.hasMorePages() ? this.url(this.currentPage + 1) : null,
    };
  }

  toJSON(replacement?: unknown): Record<string, unknown> {
    // `JSON.stringify` calls `toJSON(key)`; only an array replaces the items.
    const data = Array.isArray(replacement) ? replacement : undefined;
    return {
      data: data ?? this.pageItems(),
      links: this.links(),
      meta: {
        current_page: this.currentPage,
        per_page: this.perPage,
        path: this.options.path,
      },
    };
  }
}
