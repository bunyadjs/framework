/** Shared sitemap config set by `SitemapServiceProvider` (or `setSitemapConfig`). */
import type { SitemapConfig } from "./domains.ts";

let current: SitemapConfig | null = null;

export function setSitemapConfig(config: SitemapConfig | null): void {
  current = config;
}

export function getSitemapConfig(): SitemapConfig {
  if (!current) {
    throw new Error(
      "No sitemap config: register SitemapServiceProvider or call setSitemapConfig().",
    );
  }
  return current;
}
