/**
 * The largest page a list endpoint will hand out.
 *
 * `paginate`, `simplePaginate` and `cursorPaginate` clamp the requested page size to this, so a
 * request for `?per_page=1000000` returns one page of at most this many rows instead of the
 * whole table. Set it once (the framework reads `database.pagination.max_per_page`); a model can
 * lower or raise it for itself with `static maxPerPage`.
 */
export const DEFAULT_MAX_PER_PAGE = 100;
/** Page size used when none (or nonsense) is asked for. */
export const DEFAULT_PER_PAGE = 15;

let maxPerPage = DEFAULT_MAX_PER_PAGE;

/** Set the application-wide largest page size. Must be a whole number of at least 1. */
export function setMaxPerPage(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`The largest page size must be a whole number of at least 1, got ${String(value)}.`);
  }
  maxPerPage = value;
}

export function getMaxPerPage(): number {
  return maxPerPage;
}

/**
 * The page size to use for a requested one: a number from 1 up to the limit.
 * Anything that is not a number (or is 0) falls back to `fallback`; negatives become 1;
 * `limit` defaults to the application-wide maximum, and `Infinity` removes it.
 */
export function clampPerPage(
  requested: unknown,
  options: { fallback?: number; limit?: number } = {},
): number {
  const fallback = options.fallback ?? DEFAULT_PER_PAGE;
  const limit = options.limit ?? maxPerPage;
  const size = Math.max(1, Math.floor(Number(requested)) || fallback);
  return Math.min(size, limit);
}
