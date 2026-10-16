/**
 * Streaming sitemap writer: one `<url>` at a time, rollover at 50,000 URLs or
 * 52,428,800 uncompressed bytes, optional gzip of split parts (SPEC D2), and
 * an atomic publish (parts first, index last, stale parts removed).
 */
import { Buffer } from "node:buffer";
import {
  escapeXml,
  hostOf,
  InvalidSitemapUrlError,
  resolveLoc,
} from "./escape.ts";
import { toW3cDate } from "./date.ts";
import type { SinkWritable, SitemapSink } from "./sinks.ts";
import { Url, type ChangeFrequency } from "./url.ts";

export const MAX_URLS_PER_SITEMAP = 50_000;
export const MAX_SITEMAP_BYTES = 52_428_800;
export const MAX_SITEMAPS_PER_INDEX = 50_000;

export type SitemapNamespace = "xhtml" | "image" | "video" | "news";

export const NAMESPACES: Record<SitemapNamespace, string> = {
  xhtml: "http://www.w3.org/1999/xhtml",
  image: "http://www.google.com/schemas/sitemap-image/1.1",
  video: "http://www.google.com/schemas/sitemap-video/1.1",
  news: "http://www.google.com/schemas/sitemap-news/0.9",
};
const ALL_NAMESPACES: SitemapNamespace[] = ["xhtml", "image", "video", "news"];

export type SitemapDefaults = {
  changefreq?: ChangeFrequency | null;
  priority?: number | null;
};

export type SitemapWriterOptions = {
  sink: SitemapSink;
  /** Root file name; the index when split, else the single sitemap. Default `sitemap.xml`. */
  filename?: string;
  /** Resolves relative `<loc>`s and the index `<loc>`s of split parts. */
  baseUrl?: string;
  /** Public URL of the sink directory for index entries. Default `baseUrl`. */
  publicUrl?: string;
  maxUrls?: number;
  maxBytes?: number;
  /** gzip split part files (`.xml.gz`); the root file stays plain XML (D2). */
  gzip?: boolean;
  stylesheet?: string | null;
  namespaces?: SitemapNamespace[];
  defaults?: SitemapDefaults;
  /** Host every `<loc>` must belong to (D7). Mismatch warns, or throws when `strict`. */
  host?: string;
  strict?: boolean;
  onWarning?: (message: string) => void;
};

export type WrittenFile = { path: string; urls: number; bytes: number };
export type WriteResult = {
  files: WrittenFile[];
  index?: string;
  urls: number;
  warnings: number;
};

export class SitemapTagTooLargeError extends Error {
  override name = "SitemapTagTooLargeError";
}
export class SitemapLimitError extends Error {
  override name = "SitemapLimitError";
}

const FLUSH_CHARS = 1 << 16;
const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function stylesheetPi(href: string | null | undefined): string {
  return href
    ? `<?xml-stylesheet type="text/xsl" href="${escapeXml(href)}"?>\n`
    : "";
}

export function urlsetOpen(
  namespaces: SitemapNamespace[] = ALL_NAMESPACES,
): string {
  let attrs = ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  for (const ns of namespaces) attrs += ` xmlns:${ns}="${NAMESPACES[ns]}"`;
  return `<urlset${attrs}>\n`;
}
export const URLSET_CLOSE = "</urlset>\n";
export const INDEX_OPEN =
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
export const INDEX_CLOSE = "</sitemapindex>\n";

const encoder = new TextEncoder();

/** gzip a sink writable on the fly (back-pressure preserved). */
function gzipWritable(target: SinkWritable): SinkWritable {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await target.write(value);
    }
  })();
  pump.catch(() => {});
  return {
    async write(chunk) {
      await writer.ready;
      await writer.write(chunk as Uint8Array<ArrayBuffer>);
    },
    async close() {
      await writer.close();
      await pump;
      await target.close();
    },
    async abort() {
      await writer.abort().catch(() => {});
      await target.abort();
    },
  };
}

type Part = {
  temp: string;
  out: SinkWritable;
  urls: number;
  bytes: number;
  gzipped: boolean;
};

let tokenSeq = 0;

export class SitemapWriter {
  readonly #o: Required<
    Pick<
      SitemapWriterOptions,
      "filename" | "maxUrls" | "maxBytes" | "gzip" | "strict"
    >
  > &
    SitemapWriterOptions;
  readonly #base: string;
  readonly #token: string;
  readonly #header: string;
  readonly #footerBytes: number;
  readonly #encodeOptions: { baseUrl?: string; defaults?: SitemapDefaults };
  readonly #host: string | null;
  #parts: { temp: string; urls: number; bytes: number; gzipped: boolean }[] =
    [];
  #current: Part | null = null;
  #pending = "";
  #total = 0;
  #warnings = 0;
  #closed = false;

  constructor(options: SitemapWriterOptions) {
    const maxUrls = options.maxUrls ?? MAX_URLS_PER_SITEMAP;
    const maxBytes = options.maxBytes ?? MAX_SITEMAP_BYTES;
    if (!(maxUrls >= 1 && maxUrls <= MAX_URLS_PER_SITEMAP)) {
      throw new RangeError(
        `maxUrls must be between 1 and ${MAX_URLS_PER_SITEMAP}.`,
      );
    }
    if (!(maxBytes >= 1 && maxBytes <= MAX_SITEMAP_BYTES)) {
      throw new RangeError(
        `maxBytes must be between 1 and ${MAX_SITEMAP_BYTES}.`,
      );
    }
    const filename = options.filename ?? "sitemap.xml";
    this.#o = {
      ...options,
      filename,
      maxUrls,
      maxBytes,
      gzip: options.gzip ?? false,
      strict: options.strict ?? false,
    };
    this.#base = filename.replace(/\.xml$/i, "");
    this.#token = `${process.pid}-${Date.now().toString(36)}-${(tokenSeq++).toString(36)}`;
    this.#header =
      XML_DECL +
      stylesheetPi(options.stylesheet) +
      urlsetOpen(options.namespaces);
    this.#footerBytes = URLSET_CLOSE.length;
    this.#encodeOptions = {
      baseUrl: options.baseUrl,
      defaults: options.defaults,
    };
    this.#host = options.host ? options.host.toLowerCase() : null;
  }

  /** URLs written so far. */
  get count(): number {
    return this.#total;
  }

  #partName(n: number, gzipped: boolean): string {
    return `${this.#base}-${n}.xml${gzipped ? ".gz" : ""}`;
  }

  async #open(): Promise<void> {
    const n = this.#parts.length + 1;
    const gzipped = this.#o.gzip && n > 1;
    const temp = `.${this.#base}-${n}.${this.#token}.tmp`;
    const raw = await this.#o.sink.open(temp);
    const out = gzipped ? gzipWritable(raw) : raw;
    this.#current = { temp, out, urls: 0, bytes: 0, gzipped };
    this.#pending = this.#header;
    this.#current.bytes = Buffer.byteLength(this.#header);
  }

  async #flush(): Promise<void> {
    if (!this.#current || this.#pending === "") return;
    const chunk = encoder.encode(this.#pending);
    this.#pending = "";
    await this.#current.out.write(chunk);
  }

  async #finishPart(): Promise<void> {
    const part = this.#current;
    if (!part) return;
    this.#pending += URLSET_CLOSE;
    part.bytes += this.#footerBytes;
    await this.#flush();
    await part.out.close();
    this.#parts.push({
      temp: part.temp,
      urls: part.urls,
      bytes: part.bytes,
      gzipped: part.gzipped,
    });
    this.#current = null;
    // Once we know the set is split, part 1 (written plain) is gzipped too.
    if (this.#o.gzip && this.#parts.length === 1) return;
    if (this.#o.gzip && this.#parts.length === 2 && !this.#parts[0]?.gzipped) {
      await this.#gzipFirstPart();
    }
  }

  async #gzipFirstPart(): Promise<void> {
    const first = this.#parts[0];
    if (!first) return;
    const sink = this.#o.sink;
    const temp = `.${this.#base}-1.gz.${this.#token}.tmp`;
    const out = gzipWritable(await sink.open(temp));
    try {
      for await (const chunk of sink.read(first.temp)) await out.write(chunk);
      await out.close();
    } catch (error) {
      await out.abort();
      throw error;
    }
    await sink.delete(first.temp);
    first.temp = temp;
    first.gzipped = true;
  }

  /** Append one URL (string or `Url`). Rolls over to a new part when a limit would be hit. */
  async write(tag: Url | string): Promise<void> {
    if (this.#closed) throw new Error("SitemapWriter is closed.");
    const url = typeof tag === "string" ? new Url(tag) : tag;
    if (this.#host !== null) this.#checkHost(url.url);
    const xml = url.toXml(this.#encodeOptions);
    const size = Buffer.byteLength(xml) + 1;
    if (this.#current === null) await this.#open();
    let part = this.#current as Part;
    if (
      part.urls + 1 > this.#o.maxUrls ||
      part.bytes + size + this.#footerBytes > this.#o.maxBytes
    ) {
      if (part.urls === 0) {
        throw new SitemapTagTooLargeError(
          `A single <url> (${size} bytes) does not fit in a ${this.#o.maxBytes}-byte sitemap.`,
        );
      }
      await this.#finishPart();
      await this.#open();
      part = this.#current as Part;
      if (part.bytes + size + this.#footerBytes > this.#o.maxBytes) {
        throw new SitemapTagTooLargeError(
          `A single <url> (${size} bytes) does not fit in a ${this.#o.maxBytes}-byte sitemap.`,
        );
      }
    }
    this.#pending += xml + "\n";
    part.urls++;
    part.bytes += size;
    this.#total++;
    if (this.#pending.length >= FLUSH_CHARS) await this.#flush();
  }

  #checkHost(loc: string): void {
    const resolved = resolveLoc(loc, this.#o.baseUrl);
    if (hostOf(resolved) === this.#host) return;
    const message = `Sitemap URL [${resolved}] is not on host [${this.#host}].`;
    if (this.#o.strict) throw new InvalidSitemapUrlError(message);
    this.#warnings++;
    this.#o.onWarning?.(message);
  }

  /** Abort: remove temp files, leave any previously published set intact. */
  async abort(): Promise<void> {
    this.#closed = true;
    const sink = this.#o.sink;
    if (this.#current) await this.#current.out.abort();
    this.#current = null;
    for (const part of this.#parts) await sink.delete(part.temp);
    this.#parts = [];
  }

  /** Finish, publish atomically (parts, then root/index), remove stale parts. */
  async close(): Promise<WriteResult> {
    if (this.#closed) throw new Error("SitemapWriter is closed.");
    try {
      if (this.#current === null) await this.#open();
      await this.#finishPart();
      return await this.#publish();
    } catch (error) {
      await this.abort();
      throw error;
    } finally {
      this.#closed = true;
    }
  }

  async #readManifest(name: string): Promise<string[]> {
    const sink = this.#o.sink;
    if (!(await sink.list()).includes(name)) return [];
    try {
      let text = "";
      const decoder = new TextDecoder();
      for await (const chunk of sink.read(name))
        text += decoder.decode(chunk, { stream: true });
      const files = (JSON.parse(text) as { files?: unknown }).files;
      if (!Array.isArray(files)) return [];
      const own = new RegExp(
        `^${this.#base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+\\.xml(?:\\.gz)?$`,
      );
      return files.filter(
        (f): f is string => typeof f === "string" && own.test(f),
      );
    } catch {
      return [];
    }
  }

  async #publish(): Promise<WriteResult> {
    const sink = this.#o.sink;
    const { filename } = this.#o;
    const result: WriteResult = {
      files: [],
      urls: this.#total,
      warnings: this.#warnings,
    };
    const keep = new Set<string>([filename]);
    if (this.#parts.length === 1) {
      const only = this.#parts[0];
      if (!only) throw new Error("SitemapWriter has no part to publish.");
      await sink.move(only.temp, filename);
      result.files.push({ path: filename, urls: only.urls, bytes: only.bytes });
    } else {
      if (this.#parts.length > MAX_SITEMAPS_PER_INDEX) {
        throw new SitemapLimitError(
          `A sitemap index may reference at most ${MAX_SITEMAPS_PER_INDEX} sitemaps.`,
        );
      }
      const names = this.#parts.map((p, i) => this.#partName(i + 1, p.gzipped));
      for (const [i, part] of this.#parts.entries()) {
        const name = names[i] as string;
        await sink.move(part.temp, name);
        keep.add(name);
        result.files.push({ path: name, urls: part.urls, bytes: part.bytes });
      }
      const publicUrl = this.#o.publicUrl ?? this.#o.baseUrl;
      if (!publicUrl) {
        throw new SitemapLimitError(
          "Split sitemaps need a baseUrl (or publicUrl) for the index.",
        );
      }
      const prefix = publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`;
      const lastmod = toW3cDate(new Date());
      const temp = `.${this.#base}.index.${this.#token}.tmp`;
      const out = await sink.open(temp);
      let xml = XML_DECL + stylesheetPi(this.#o.stylesheet) + INDEX_OPEN;
      for (const name of names) {
        xml += `<sitemap><loc>${escapeXml(resolveLoc(prefix + name))}</loc><lastmod>${lastmod}</lastmod></sitemap>\n`;
        if (xml.length >= FLUSH_CHARS) {
          await out.write(encoder.encode(xml));
          xml = "";
        }
      }
      xml += INDEX_CLOSE;
      await out.write(encoder.encode(xml));
      await out.close();
      await sink.move(temp, filename);
      result.index = filename;
    }
    // F5: only delete parts this writer published before (manifest), never
    // foreign `sitemap-N.xml` files that happen to share the directory.
    const manifestName = `.${this.#base}.manifest.json`;
    const previous = await this.#readManifest(manifestName);
    for (const name of previous) {
      if (!keep.has(name)) await sink.delete(name);
    }
    const manifestTemp = `${manifestName}.${this.#token}.tmp`;
    const mout = await sink.open(manifestTemp);
    await mout.write(encoder.encode(JSON.stringify({ files: [...keep] })));
    await mout.close();
    await sink.move(manifestTemp, manifestName);
    return result;
  }
}
