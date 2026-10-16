/**
 * Domain sets (SPEC D7): each host gets its own sitemap set + base URL,
 * independent of APP_URL. Single-domain config (`baseUrl` + `build`) is sugar
 * for one domain written at `path` (default `sitemap.xml`); multi-domain sets
 * are written under `sitemaps/<host>/`.
 */
import { Sitemap } from "./sitemap.ts";
import type { SitemapSink } from "./sinks.ts";
import type { SitemapDefaults, WriteResult } from "./writer.ts";

export type SitemapBuild = (
  sitemap: Sitemap,
  domain: ResolvedDomain,
) => void | Sitemap | Promise<void | Sitemap>;

export type DomainConfig = {
  baseUrl: string;
  /** File name of this domain's root sitemap. Default: config `path`. */
  path?: string;
  build?: SitemapBuild;
};

export type RobotsRule = {
  userAgent: string | string[];
  allow?: string[];
  disallow?: string[];
};

export type SitemapConfig = {
  disk?: string;
  path?: string;
  gzip?: boolean;
  maxTagsPerSitemap?: number;
  stylesheet?: string | null;
  defaults?: SitemapDefaults;
  /** Cross-host `<loc>`s throw instead of warning. */
  strict?: boolean;
  route?: { enabled?: boolean; path?: string };
  robots?: { enabled?: boolean; path?: string; rules?: RobotsRule[] };
  cache?: { maxAge?: number; staleWhileRevalidate?: number };
  baseUrl?: string;
  build?: SitemapBuild;
  domains?: Record<string, DomainConfig>;
};

export type ResolvedDomain = {
  host: string;
  baseUrl: string;
  /** Directory on the disk ("" for single-domain). */
  directory: string;
  /** Root file name within `directory`. */
  filename: string;
  /** Disk path of the root file (`directory/filename`). */
  path: string;
  /** Public URL of the root sitemap (what robots.txt and crawlers use). */
  sitemapUrl: string;
  /** Public URL prefix for split parts referenced by the index. */
  publicUrl: string;
  build?: SitemapBuild;
};

const SAFE_HOST = /^[a-z0-9.-]+(?::\d{1,5})?$/;
const SAFE_FILE = /^[A-Za-z0-9._-]+\.xml$/;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function hostOfBase(baseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid sitemap baseUrl [${baseUrl}].`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Sitemap baseUrl [${baseUrl}] must use http or https.`);
  }
  return parsed.host.toLowerCase();
}

function fileName(path: string | undefined): string {
  const name = (path ?? "sitemap.xml").replace(/^\/+/, "");
  if (!SAFE_FILE.test(name)) {
    throw new Error(`Sitemap path [${path}] must be a plain *.xml file name.`);
  }
  return name;
}

/** Resolve the configured domain set (sugar → one entry). */
export function resolveDomains(config: SitemapConfig): ResolvedDomain[] {
  const routeEnabled = config.route?.enabled !== false;
  const routePath = config.route?.path ?? "/sitemap.xml";
  const routeDir = routePath.slice(0, routePath.lastIndexOf("/") + 1) || "/";

  const make = (
    host: string,
    domain: DomainConfig,
    directory: string,
  ): ResolvedDomain => {
    const baseUrl = trimSlash(domain.baseUrl);
    const actualHost = hostOfBase(baseUrl);
    if (actualHost !== host) {
      throw new Error(
        `Sitemap domain [${host}] does not match its baseUrl host [${actualHost}].`,
      );
    }
    if (!SAFE_HOST.test(host))
      throw new Error(`Invalid sitemap domain [${host}].`);
    const filename = fileName(domain.path ?? config.path);
    const path = directory ? `${directory}/${filename}` : filename;
    // D5: the auto-route serves the root + parts per host; when disabled, files are served from the public disk.
    const sitemapUrl = routeEnabled
      ? `${baseUrl}${routePath}`
      : `${baseUrl}/${path}`;
    const publicUrl = routeEnabled
      ? `${baseUrl}${routeDir}`
      : `${baseUrl}/${directory ? `${directory}/` : ""}`;
    return {
      host,
      baseUrl,
      directory,
      filename,
      path,
      sitemapUrl,
      publicUrl,
      build: domain.build,
    };
  };

  if (config.domains && Object.keys(config.domains).length > 0) {
    if (config.baseUrl) {
      throw new Error(
        "Sitemap config: use either `baseUrl` + `build` or `domains`, not both.",
      );
    }
    return Object.entries(config.domains).map(([key, domain]) => {
      const host = key.toLowerCase();
      return make(
        host,
        { ...domain, build: domain.build ?? config.build },
        `sitemaps/${host}`,
      );
    });
  }
  if (!config.baseUrl) {
    throw new Error(
      "Sitemap config needs a `baseUrl` (or `domains`); APP_URL is never used.",
    );
  }
  const host = hostOfBase(config.baseUrl);
  return [
    make(
      host,
      { baseUrl: config.baseUrl, path: config.path, build: config.build },
      "",
    ),
  ];
}

/** Domain serving `host` (Host header, case-insensitive), if configured. */
export function findDomain(
  config: SitemapConfig,
  host: string,
): ResolvedDomain | undefined {
  const wanted = host.toLowerCase();
  return resolveDomains(config).find((d) => d.host === wanted);
}

export type GenerateOptions = {
  /** Sink rooted at the domain's `directory`. */
  sinkFor: (domain: ResolvedDomain) => SitemapSink;
  /** Only this host. */
  domain?: string;
  gzip?: boolean;
  /** Run the build inside a URL-root scope (e.g. `Url.withRoot`) — Phase 2 router glue. */
  scope?: <T>(baseUrl: string, fn: () => Promise<T>) => Promise<T>;
  onWarning?: (message: string) => void;
};

export type DomainResult = { domain: ResolvedDomain; result: WriteResult };

/** Build + write every (or one) domain's set, sequentially. */
export async function generateSitemaps(
  config: SitemapConfig,
  options: GenerateOptions,
): Promise<DomainResult[]> {
  let domains = resolveDomains(config);
  if (options.domain !== undefined) {
    const wanted = options.domain.toLowerCase();
    domains = domains.filter((d) => d.host === wanted);
    if (domains.length === 0)
      throw new Error(`Sitemap domain [${options.domain}] is not configured.`);
  }
  const results: DomainResult[] = [];
  for (const domain of domains) {
    const run = async () => {
      const sitemap = Sitemap.create({
        baseUrl: domain.baseUrl,
        defaults: config.defaults,
        stylesheet: config.stylesheet ?? null,
        maxTagsPerSitemap: config.maxTagsPerSitemap,
        host: domain.host,
        strict: config.strict,
        onWarning: options.onWarning,
      });
      const built = (await domain.build?.(sitemap, domain)) ?? sitemap;
      return built.writeTo(options.sinkFor(domain), domain.filename, {
        gzip: options.gzip ?? config.gzip ?? false,
        publicUrl: domain.publicUrl,
      });
    };
    const result = options.scope
      ? await options.scope(domain.baseUrl, run)
      : await run();
    results.push({ domain, result });
  }
  return results;
}
