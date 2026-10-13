/**
 * `SitemapIndex` — spatie `Spatie\Sitemap\SitemapIndex` names.
 */
import { basename, dirname } from "node:path";
import { fileSink, type SitemapSink } from "./sinks.ts";
import { SitemapTag } from "./sitemap-tag.ts";
import {
  INDEX_CLOSE,
  INDEX_OPEN,
  MAX_SITEMAPS_PER_INDEX,
  SitemapLimitError,
  stylesheetPi,
} from "./writer.ts";

export class SitemapIndex {
  #tags: SitemapTag[] = [];
  #stylesheet: string | null = null;
  #baseUrl: string | undefined;

  constructor(options: { baseUrl?: string } = {}) {
    this.#baseUrl = options.baseUrl;
  }

  static create(options: { baseUrl?: string } = {}): SitemapIndex {
    return new SitemapIndex(options);
  }

  add(tag: string | SitemapTag): this {
    if (typeof tag === "string" && tag === "") return this;
    this.#tags.push(typeof tag === "string" ? SitemapTag.create(tag) : tag);
    return this;
  }

  setStylesheet(url: string): this {
    this.#stylesheet = url;
    return this;
  }

  getTags(): SitemapTag[] {
    return [...this.#tags];
  }

  getSitemap(url: string): SitemapTag | undefined {
    return this.#tags.find((tag) => tag.url === url);
  }

  hasSitemap(url: string): boolean {
    return this.getSitemap(url) !== undefined;
  }

  render(): string {
    if (this.#tags.length > MAX_SITEMAPS_PER_INDEX) {
      throw new SitemapLimitError(
        `A sitemap index may reference at most ${MAX_SITEMAPS_PER_INDEX} sitemaps.`,
      );
    }
    let xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      stylesheetPi(this.#stylesheet) +
      INDEX_OPEN;
    for (const tag of this.#tags) xml += tag.toXml(this.#baseUrl) + "\n";
    return xml + INDEX_CLOSE;
  }

  async writeTo(sink: SitemapSink, filename = "sitemap.xml"): Promise<void> {
    const xml = this.render();
    const temp = `.${filename}.${process.pid}.${Date.now().toString(36)}.tmp`;
    const out = await sink.open(temp);
    try {
      await out.write(new TextEncoder().encode(xml));
      await out.close();
    } catch (error) {
      await out.abort();
      throw error;
    }
    await sink.move(temp, filename);
  }

  writeToFile(path: string): Promise<void> {
    return this.writeTo(fileSink(dirname(path)), basename(path));
  }
}
