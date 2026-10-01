export type InertiaPage = {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string | null;
  encryptHistory?: boolean;
  clearHistory?: boolean;
  deferredProps?: Record<string, string[]>;
  /** Keys that come from shared props (instant visits reuse them). */
  sharedProps?: string[];
  /** Props (or `prop.path`s) a partial reload appends, prepends, or deep-merges. */
  mergeProps?: string[];
  prependProps?: string[];
  deepMergeProps?: string[];
  /** `prop.field`: merged rows with the same field replace their old copy. */
  matchPropsOn?: string[];
  /** Pagination state for `<InfiniteScroll>`, by prop. */
  scrollProps?: Record<string, { pageName: string; previousPage: number | null; nextPage: number | null; currentPage: number; reset: boolean }>;
  /** Props the client keeps across visits, by remembered name. */
  onceProps?: Record<string, { prop: string; expiresAt: number | null }>;
  /** `Inertia.flash()` values for this response. */
  flash?: Record<string, unknown>;
};

/** Encode page JSON for safe embedding in HTML attributes. */
export function encodePageJson(page: InertiaPage): string {
  return JSON.stringify(page)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
