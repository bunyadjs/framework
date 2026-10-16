/**
 * `Sitemap` façade — spatie `Spatie\Sitemap\Sitemap` names (pinned v8.2.0),
 * async and streaming: sources are pulled only while writing.
 */
import { Buffer } from "node:buffer";
import { basename, dirname } from "node:path";
import { fileSink, type SitemapSink } from "./sinks.ts";
import { Url } from "./url.ts";
import {
  MAX_SITEMAP_BYTES,
  MAX_URLS_PER_SITEMAP,
  SitemapLimitError,
  SitemapWriter,
  stylesheetPi,
  urlsetOpen,
  URLSET_CLOSE,
  type SitemapDefaults,
  type SitemapNamespace,
  type WriteResult,
} from "./writer.ts";

/** spatie `Contracts\Sitemapable`. */
export interface Sitemapable {
  toSitemapTag(): Url | string | Array<Url | string>;
}

export type SitemapItem = Url | string | Sitemapable;
export type SitemapSource =
  | SitemapItem
  | Iterable<SitemapItem | null | undefined>
  | AsyncIterable<SitemapItem | null | undefined>;

export type SitemapOptions = {
  baseUrl?: string;
  defaults?: SitemapDefaults;
  gzip?: boolean;
  stylesheet?: string | null;
  namespaces?: SitemapNamespace[];
  host?: string;
  strict?: boolean;
  maxTagsPerSitemap?: number;
  onWarning?: (message: string) => void;
};

export type WriteOptions = {
  gzip?: boolean;
  /** Public URL of the directory holding split parts (index `<loc>`s). */
  publicUrl?: string;
};

type Entry =
  { tag: Url } | { lazy: Iterable<unknown> | AsyncIterable<unknown> };

function isSitemapable(value: unknown): value is Sitemapable {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toSitemapTag?: unknown }).toSitemapTag === "function"
  );
}

function isIterable(
  value: unknown,
): value is Iterable<unknown> | AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (Symbol.iterator in value || Symbol.asyncIterator in value)
  );
}

/** Normalise one item to zero or more `Url`s (spatie skips empty strings). */
export function toUrls(item: unknown): Url[] {
  if (item === null || item === undefined) return [];
  if (item instanceof Url) return [item];
  if (Array.isArray(item)) return item.flatMap(toUrls);
  if (typeof item === "string") return item === "" ? [] : [Url.create(item)];
  if (isSitemapable(item)) {
    const tag = item.toSitemapTag();
    return Array.isArray(tag) ? tag.flatMap(toUrls) : toUrls(tag);
  }
  throw new TypeError(
    "Sitemap.add() expects a string, Url, Sitemapable or an iterable of them.",
  );
}

export class Sitemap {
  #entries: Entry[] = [];
  #options: SitemapOptions;
  #maxTags: number;
  #stylesheet: string | null;

  constructor(options: SitemapOptions = {}) {
    this.#options = { ...options };
    this.#maxTags = options.maxTagsPerSitemap ?? MAX_URLS_PER_SITEMAP;
    this.#stylesheet = options.stylesheet ?? null;
  }

  static create(options: SitemapOptions = {}): Sitemap {
    return new Sitemap(options);
  }

  /** Strings, `Url`s, `Sitemapable`s, arrays (expanded now) or (async) iterables (pulled on write). */
  add(tag: SitemapSource): this {
    if (Array.isArray(tag)) {
      for (const item of tag) this.add(item as SitemapSource);
      return this;
    }
    if (
      typeof tag !== "string" &&
      !(tag instanceof Url) &&
      !isSitemapable(tag) &&
      isIterable(tag)
    ) {
      this.#entries.push({ lazy: tag });
      return this;
    }
    for (const url of toUrls(tag)) this.#entries.push({ tag: url });
    return this;
  }

  maxTagsPerSitemap(max = MAX_URLS_PER_SITEMAP): this {
    if (!(max >= 1 && max <= MAX_URLS_PER_SITEMAP)) {
      throw new RangeError(
        `maxTagsPerSitemap must be between 1 and ${MAX_URLS_PER_SITEMAP}.`,
      );
    }
    this.#maxTags = max;
    return this;
  }

  setStylesheet(url: string): this {
    this.#stylesheet = url;
    return this;
  }

  /** In-memory tags (lazy sources are not pulled). */
  getTags(): Url[] {
    const tags: Url[] = [];
    for (const entry of this.#entries) if ("tag" in entry) tags.push(entry.tag);
    return tags;
  }

  getUrl(url: string): Url | undefined {
    return this.getTags().find((tag) => tag.url === url);
  }

  hasUrl(url: string): boolean {
    return this.getUrl(url) !== undefined;
  }

  /** Sort in-memory tags by URL (spatie v8.1). Lazy sources keep their position at the end. */
  sort(): this {
    const tags = this.getTags().sort((a, b) =>
      a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
    );
    const lazy = this.#entries.filter((e) => "lazy" in e);
    this.#entries = [...tags.map((tag) => ({ tag })), ...lazy];
    return this;
  }

  /** Every URL in order, pulling lazy sources as consumed. */
  async *tags(): AsyncGenerator<Url> {
    for (const entry of this.#entries) {
      if ("tag" in entry) {
        yield entry.tag;
        continue;
      }
      for await (const item of entry.lazy as AsyncIterable<unknown>) {
        for (const url of toUrls(item)) yield url;
      }
    }
  }

  #encodeOptions() {
    return { baseUrl: this.#options.baseUrl, defaults: this.#options.defaults };
  }

  #head(): string {
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      stylesheetPi(this.#stylesheet) +
      urlsetOpen(this.#options.namespaces)
    );
  }

  /** Whole document as a string (in-memory tags only; throws past the limits). */
  render(): string {
    if (this.#entries.some((e) => "lazy" in e)) {
      throw new SitemapLimitError(
        "render() cannot pull lazy sources; use stream() or writeToFile().",
      );
    }
    const tags = this.getTags();
    if (tags.length > this.#maxTags) {
      throw new SitemapLimitError(
        `render() holds one document (max ${this.#maxTags} URLs); use writeToFile() to split.`,
      );
    }
    const options = this.#encodeOptions();
    let xml = this.#head();
    for (const tag of tags) xml += tag.toXml(options) + "\n";
    xml += URLSET_CLOSE;
    if (Buffer.byteLength(xml) > MAX_SITEMAP_BYTES) {
      throw new SitemapLimitError(
        "Sitemap exceeds 50 MB; use writeToFile() to split.",
      );
    }
    return xml;
  }

  /** One document, streamed (throws once a limit is exceeded; large sets → writeToFile). */
  async *stream(): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    const options = this.#encodeOptions();
    let pending = this.#head();
    let bytes = Buffer.byteLength(pending);
    let count = 0;
    for await (const tag of this.tags()) {
      const xml = tag.toXml(options) + "\n";
      bytes += Buffer.byteLength(xml);
      if (
        ++count > this.#maxTags ||
        bytes + URLSET_CLOSE.length > MAX_SITEMAP_BYTES
      ) {
        throw new SitemapLimitError(
          "Sitemap exceeds one document's limits; generate split files with writeToFile().",
        );
      }
      pending += xml;
      if (pending.length >= 1 << 16) {
        yield encoder.encode(pending);
        pending = "";
      }
    }
    yield encoder.encode(pending + URLSET_CLOSE);
  }

  /** Stream into any sink; splits + index automatically. */
  async writeTo(
    sink: SitemapSink,
    filename = "sitemap.xml",
    options: WriteOptions = {},
  ): Promise<WriteResult> {
    const writer = new SitemapWriter({
      sink,
      filename,
      baseUrl: this.#options.baseUrl,
      publicUrl: options.publicUrl,
      maxUrls: this.#maxTags,
      gzip: options.gzip ?? this.#options.gzip ?? false,
      stylesheet: this.#stylesheet,
      namespaces: this.#options.namespaces,
      defaults: this.#options.defaults,
      host: this.#options.host,
      strict: this.#options.strict,
      onWarning: this.#options.onWarning,
    });
    try {
      for await (const tag of this.tags()) await writer.write(tag);
    } catch (error) {
      await writer.abort();
      throw error;
    }
    return writer.close();
  }

  /** spatie `writeToFile($path)`: plain root file; split parts (optionally gzipped) beside it. */
  writeToFile(path: string, options: WriteOptions = {}): Promise<WriteResult> {
    return this.writeTo(fileSink(dirname(path)), basename(path), options);
  }
}
