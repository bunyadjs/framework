/** Coerce a cached value to a counter base (missing/null → 0). */
export function counterBase(current: unknown): number {
  if (current === undefined || current === null) return 0;
  const n = Number(current);
  return Number.isFinite(n) ? n : 0;
}
