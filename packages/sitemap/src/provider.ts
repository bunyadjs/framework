/**
 * `@bunyad/sitemap/provider` — `SitemapServiceProvider` (T2.5, T2.7):
 * reads `config/sitemap.ts`, registers `sitemap:generate`, auto-registers
 * `GET /sitemap.xml` (+ split parts) per Host (D5/D7) and optionally
 * `GET /robots.txt` (D6). Routes serve pre-generated files only.
 */
import { ServiceProvider } from "@bunyad/core";
import type { Filesystem } from "@bunyad/contracts";
import { Storage } from "@bunyad/filesystem";
import { Route, type Router } from "@bunyad/router";
import { fileURLToPath } from "node:url";
import { SitemapGenerateCommand } from "./command.ts";
import { findDomain, resolveDomains, type SitemapConfig } from "./domains.ts";
import { serveSitemapFile } from "./http.ts";
import { robotsFor } from "./robots.ts";
import { setSitemapConfig } from "./state.ts";

type RequestLike = {
  host(): string;
  header(name: string): string | null;
  method?: string;
};

function hostname(request: RequestLike): string {
  return request.host().toLowerCase();
}

/** Domain for this request: by Host in multi-domain configs; the single domain otherwise. */
function domainFor(config: SitemapConfig, request: RequestLike) {
  const domains = resolveDomains(config);
  if (!config.domains) return domains[0];
  return (
    findDomain(config, hostname(request)) ??
    findDomain(config, hostname(request).split(":")[0] ?? "")
  );
}

/** Handler for the root route (`route.path`). */
export function sitemapRootHandler(
  config: SitemapConfig,
  disk: () => Filesystem,
) {
  return async (request: RequestLike): Promise<Response> => {
    const domain = domainFor(config, request);
    if (!domain) return new Response("Not Found", { status: 404 });
    return serveSitemapFile(disk(), domain.path, request, config.cache);
  };
}

/** Handler for split part files next to the root (`/sitemap-3.xml.gz`). */
export function sitemapPartHandler(
  config: SitemapConfig,
  disk: () => Filesystem,
) {
  return async (request: RequestLike, file: string): Promise<Response> => {
    const domain = domainFor(config, request);
    if (!domain) return new Response("Not Found", { status: 404 });
    const base = domain.filename.replace(/\.xml$/, "");
    if (
      !new RegExp(`^${base.replace(/[.]/g, "\\.")}-\\d+\\.xml(?:\\.gz)?$`).test(
        file,
      )
    ) {
      return new Response("Not Found", { status: 404 });
    }
    const path = domain.directory ? `${domain.directory}/${file}` : file;
    return serveSitemapFile(disk(), path, request, config.cache);
  };
}

/** Register the auto-routes for `config` on the active router. */
export function registerSitemapRoutes(
  config: SitemapConfig,
  options: { disk?: () => Filesystem; router?: Router } = {},
): void {
  const getDisk = options.disk ?? (() => Storage.disk(config.disk ?? "public"));
  const router: Router = options.router ?? Route;
  if (config.route?.enabled !== false) {
    const path = config.route?.path ?? "/sitemap.xml";
    const dir = path.slice(0, path.lastIndexOf("/") + 1) || "/";
    const root = sitemapRootHandler(config, getDisk);
    const part = sitemapPartHandler(config, getDisk);
    router.get(path, (request: RequestLike) => root(request)).name("sitemap");
    router
      .get(`${dir}{sitemapPart}`, (request: RequestLike) => {
        const url = new URL(
          (request as unknown as { url: string }).url,
          "http://x",
        );
        return part(
          request,
          url.pathname.slice(url.pathname.lastIndexOf("/") + 1),
        );
      })
      .where("sitemapPart", "[A-Za-z0-9_-]+-\\d+\\.xml(?:\\.gz)?")
      .name("sitemap.part");
  }
  if (config.robots?.enabled === true) {
    router
      .get(config.robots.path ?? "/robots.txt", (request: RequestLike) => {
        const domain = domainFor(config, request);
        if (!domain) return new Response("Not Found", { status: 404 });
        return new Response(
          robotsFor(config, config.domains ? domain.host : undefined),
          {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          },
        );
      })
      .name("sitemap.robots");
  }
}

/** Path of the publishable `config/sitemap.ts` stub. */
export const SITEMAP_CONFIG_STUB = fileURLToPath(
  new URL("../stubs/config/sitemap.ts", import.meta.url),
);

export const SITEMAP_NOT_CONFIGURED =
  "[sitemap] Neither `baseUrl` nor `domains` is set in config/sitemap.ts: no sitemap routes were registered and `sitemap:generate` has nothing to write.";

/** `app.register(SitemapServiceProvider)`; configure under `sitemap` config. */
export class SitemapServiceProvider extends ServiceProvider {
  override register(): void {
    const config = (this.app.config.get("sitemap") ?? {}) as SitemapConfig;
    setSitemapConfig(config);
    this.commands([SitemapGenerateCommand]);
    this.publishes(
      { [SITEMAP_CONFIG_STUB]: "config/sitemap.ts" },
      "sitemap-config",
    );
  }

  override boot(): void {
    const config = (this.app.config.get("sitemap") ?? {}) as SitemapConfig;
    if (config.baseUrl || config.domains) {
      registerSitemapRoutes(config, { router: this.app.router });
      return;
    }
    console.warn(SITEMAP_NOT_CONFIGURED);
  }
}
