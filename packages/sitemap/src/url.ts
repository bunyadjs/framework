/**
 * `<url>` tag — spatie `Spatie\Sitemap\Tags\Url` names (pinned v8.2.0).
 * Deviations: images are `<image:loc>` only (SPEC D4); dates accept Date | string | number.
 */
import { toDate, toW3cDate, type DateInput } from "./date.ts";
import { escapeXml, resolveLoc } from "./escape.ts";

export type ChangeFrequency =
  "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

const CHANGE_FREQUENCIES = new Set<string>([
  "always",
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "never",
]);

export const MAX_IMAGES_PER_URL = 1000;

// XML NCName (ASCII subset): option keys become element names.
const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;

function assertElementNames(
  kind: string,
  ...maps: Record<string, unknown>[]
): void {
  for (const map of maps) {
    for (const key of Object.keys(map)) {
      if (!NCNAME.test(key)) {
        throw new TypeError(
          `Invalid ${kind} option name [${key}]: must be an XML NCName.`,
        );
      }
    }
  }
}

export type Alternate = { url: string; locale: string };
export type Image = { url: string };
export type VideoOptions = Record<string, string | number | boolean>;
export type Video = {
  thumbnailLoc: string;
  title: string;
  description: string;
  contentLoc: string | null;
  playerLoc: string | null;
  options: VideoOptions;
  allow: Record<string, string>;
  deny: Record<string, string>;
  tags: string[];
};
export type NewsOptions = Record<string, string>;
export type News = {
  name: string;
  language: string;
  title: string;
  publicationDate: Date;
  options: NewsOptions;
};

export type UrlTagData = {
  url: string;
  lastModificationDate: string | null;
  changeFrequency: ChangeFrequency | null;
  priority: number | null;
  alternates: Alternate[];
  images: Image[];
  videos: Video[];
  news: News[];
};

/** Encoding context passed by the writer. */
export type UrlEncodeOptions = {
  baseUrl?: string;
  defaults?: { changefreq?: ChangeFrequency | null; priority?: number | null };
};

export class Url {
  static readonly CHANGE_FREQUENCY_ALWAYS = "always";
  static readonly CHANGE_FREQUENCY_HOURLY = "hourly";
  static readonly CHANGE_FREQUENCY_DAILY = "daily";
  static readonly CHANGE_FREQUENCY_WEEKLY = "weekly";
  static readonly CHANGE_FREQUENCY_MONTHLY = "monthly";
  static readonly CHANGE_FREQUENCY_YEARLY = "yearly";
  static readonly CHANGE_FREQUENCY_NEVER = "never";

  url: string;
  lastModificationDate: Date | null = null;
  changeFrequency: ChangeFrequency | null = null;
  priority: number | null = null;
  alternates: Alternate[] = [];
  images: Image[] = [];
  videos: Video[] = [];
  news: News[] = [];

  constructor(url: string) {
    this.url = url;
  }

  static create(url: string): Url {
    return new Url(url);
  }

  setUrl(url = ""): this {
    this.url = url;
    return this;
  }

  setLastModificationDate(date: DateInput): this {
    this.lastModificationDate = toDate(date);
    return this;
  }

  setChangeFrequency(changeFrequency: ChangeFrequency): this {
    if (!CHANGE_FREQUENCIES.has(changeFrequency)) {
      throw new RangeError(
        `Invalid change frequency [${String(changeFrequency)}].`,
      );
    }
    this.changeFrequency = changeFrequency;
    return this;
  }

  /** Clamped to 0–1 like spatie. */
  setPriority(priority: number): this {
    if (!Number.isFinite(priority))
      throw new RangeError("Priority must be a finite number.");
    this.priority = Math.max(0, Math.min(priority, 1));
    return this;
  }

  addAlternate(url: string, locale = ""): this {
    this.alternates.push({ url, locale });
    return this;
  }

  /** `<image:image><image:loc>` only (SPEC D4: deprecated subtags dropped). */
  addImage(url: string): this {
    if (this.images.length >= MAX_IMAGES_PER_URL) {
      throw new RangeError(
        `A <url> may contain at most ${MAX_IMAGES_PER_URL} images.`,
      );
    }
    this.images.push({ url });
    return this;
  }

  addVideo(
    thumbnailLoc: string,
    title: string,
    description: string,
    contentLoc: string | null = null,
    playerLoc: string | null = null,
    options: VideoOptions = {},
    allow: Record<string, string> = {},
    deny: Record<string, string> = {},
    tags: string[] = [],
  ): this {
    assertElementNames("video", options, allow, deny);
    if (contentLoc === null && playerLoc === null) {
      throw new TypeError("A video needs a contentLoc or a playerLoc.");
    }
    this.videos.push({
      thumbnailLoc,
      title,
      description,
      contentLoc,
      playerLoc,
      options,
      allow,
      deny,
      tags,
    });
    return this;
  }

  addNews(
    name: string,
    language: string,
    title: string,
    publicationDate: DateInput,
    options: NewsOptions = {},
  ): this {
    assertElementNames("news", options);
    this.news.push({
      name,
      language,
      title,
      publicationDate: toDate(publicationDate),
      options,
    });
    return this;
  }

  path(): string {
    try {
      return new URL(this.url).pathname;
    } catch {
      const path = this.url.split(/[?#]/, 1)[0] ?? "";
      return path;
    }
  }

  segments(): string[];
  segments(index: number): string | null;
  segments(index?: number): string[] | string | null {
    if (index !== undefined) return this.segment(index);
    return this.path()
      .split("/")
      .filter((s) => s !== "");
  }

  /** 1-based, like spatie. */
  segment(index: number): string | null {
    return this.segments()[index - 1] ?? null;
  }

  toJSON(): UrlTagData {
    return {
      url: this.url,
      lastModificationDate: this.lastModificationDate
        ? toW3cDate(this.lastModificationDate)
        : null,
      changeFrequency: this.changeFrequency,
      priority: this.priority,
      alternates: [...this.alternates],
      images: [...this.images],
      videos: [...this.videos],
      news: [...this.news],
    };
  }

  /** Render this `<url>` element (no surrounding whitespace). */
  toXml(options: UrlEncodeOptions = {}): string {
    const base = options.baseUrl;
    let xml = `<url><loc>${escapeXml(resolveLoc(this.url, base))}</loc>`;
    if (this.lastModificationDate) {
      xml += `<lastmod>${toW3cDate(this.lastModificationDate)}</lastmod>`;
    }
    const changefreq =
      this.changeFrequency ?? options.defaults?.changefreq ?? null;
    if (changefreq !== null) xml += `<changefreq>${changefreq}</changefreq>`;
    const priority = this.priority ?? options.defaults?.priority ?? null;
    if (priority !== null)
      xml += `<priority>${(Math.round(priority * 10) / 10).toFixed(1)}</priority>`;
    // XSD: loc, lastmod, changefreq, priority, then ##other (xhtml, image, video, news).
    for (const alt of this.alternates) {
      const href = escapeXml(resolveLoc(alt.url, base));
      xml += alt.locale
        ? `<xhtml:link rel="alternate" hreflang="${escapeXml(alt.locale)}" href="${href}"/>`
        : `<xhtml:link rel="alternate" href="${href}"/>`;
    }
    for (const image of this.images) {
      xml += `<image:image><image:loc>${escapeXml(resolveLoc(image.url, base))}</image:loc></image:image>`;
    }
    for (const video of this.videos) xml += videoXml(video, base);
    for (const news of this.news) xml += newsXml(news);
    return `${xml}</url>`;
  }
}

function element(
  ns: string,
  name: string,
  value: string | number | boolean,
): string {
  const text =
    typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  return `<${ns}:${name}>${escapeXml(text)}</${ns}:${name}>`;
}

// Element order required by Google's sitemap-video 1.1 / sitemap-news 0.9 XSDs.
const VIDEO_ORDER = [
  "duration",
  "expiration_date",
  "rating",
  "content_segment_loc",
  "view_count",
  "publication_date",
  "tag",
  "category",
  "family_friendly",
  "restriction",
  "gallery_loc",
  "price",
  "requires_subscription",
  "uploader",
  "tvshow",
  "platform",
  "live",
  "id",
];
const NEWS_HEAD = ["access", "genres"];
const NEWS_TAIL = ["keywords", "stock_tickers"];

function rank(order: string[], name: string): number {
  const i = order.indexOf(name);
  return i === -1 ? order.length : i;
}

function ordered(order: string[], parts: [string, string][]): string {
  return parts
    .map((p, i) => ({ p, i, r: rank(order, p[0]) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.p[1])
    .join("");
}

function videoXml(video: Video, base: string | undefined): string {
  let xml = "<video:video>";
  xml += `<video:thumbnail_loc>${escapeXml(resolveLoc(video.thumbnailLoc, base))}</video:thumbnail_loc>`;
  xml += element("video", "title", video.title);
  xml += element("video", "description", video.description);
  if (video.contentLoc !== null) {
    xml += `<video:content_loc>${escapeXml(resolveLoc(video.contentLoc, base))}</video:content_loc>`;
  }
  if (video.playerLoc !== null) {
    xml += `<video:player_loc>${escapeXml(resolveLoc(video.playerLoc, base))}</video:player_loc>`;
  }
  const parts: [string, string][] = [];
  for (const [key, value] of Object.entries(video.options))
    parts.push([key, element("video", key, value)]);
  for (const tag of video.tags)
    parts.push(["tag", element("video", "tag", tag)]);
  for (const [rel, map] of [
    ["allow", video.allow],
    ["deny", video.deny],
  ] as const) {
    for (const [key, value] of Object.entries(map)) {
      parts.push([
        key,
        `<video:${key} relationship="${rel}">${escapeXml(value)}</video:${key}>`,
      ]);
    }
  }
  return `${xml}${ordered(VIDEO_ORDER, parts)}</video:video>`;
}

function newsXml(news: News): string {
  const head: [string, string][] = [];
  const tail: [string, string][] = [];
  for (const [key, value] of Object.entries(news.options)) {
    (NEWS_HEAD.includes(key) ? head : tail).push([
      key,
      element("news", key, value),
    ]);
  }
  let xml = "<news:news><news:publication>";
  xml += element("news", "name", news.name);
  xml += element("news", "language", news.language);
  xml += "</news:publication>";
  xml += ordered(NEWS_HEAD, head);
  xml += `<news:publication_date>${toW3cDate(news.publicationDate)}</news:publication_date>`;
  xml += element("news", "title", news.title);
  xml += ordered(NEWS_TAIL, tail);
  return `${xml}</news:news>`;
}
