/**
 * `<sitemap>` entry of a sitemap index — spatie `Spatie\Sitemap\Tags\Sitemap`
 * (renamed `SitemapTag` to avoid clashing with the `Sitemap` façade).
 */
import { toDate, toW3cDate, type DateInput } from "./date.ts";
import { escapeXml, resolveLoc } from "./escape.ts";

export class SitemapTag {
  url: string;
  lastModificationDate: Date | null = null;

  constructor(url: string) {
    this.url = url;
  }

  static create(url: string): SitemapTag {
    return new SitemapTag(url);
  }

  setUrl(url = ""): this {
    this.url = url;
    return this;
  }

  setLastModificationDate(date: DateInput): this {
    this.lastModificationDate = toDate(date);
    return this;
  }

  toXml(baseUrl?: string): string {
    let xml = `<sitemap><loc>${escapeXml(resolveLoc(this.url, baseUrl))}</loc>`;
    if (this.lastModificationDate) {
      xml += `<lastmod>${toW3cDate(this.lastModificationDate)}</lastmod>`;
    }
    return `${xml}</sitemap>`;
  }
}
