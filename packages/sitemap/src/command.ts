/**
 * `@bunyad/sitemap/command` — `bunyad sitemap:generate` (T2.6).
 *
 *   bunyad sitemap:generate [--domain=example.com] [--disk=public] [--path=sitemap.xml] [--gzip] [--dry-run]
 *
 * Exit codes: 0 success, 1 failure (unknown domain, invalid option, write error).
 */
import { Command } from "@bunyad/cli";
import type { Filesystem } from "@bunyad/contracts";
import { Storage } from "@bunyad/filesystem";
import { diskSink, safeDiskPath } from "./disk.ts";
import {
  generateSitemaps,
  resolveDomains,
  type DomainResult,
  type SitemapConfig,
} from "./domains.ts";
import { routerScope } from "./router.ts";
import { Sitemap } from "./sitemap.ts";
import { getSitemapConfig } from "./state.ts";

export type GenerateToDiskOptions = {
  disk?: string | Filesystem;
  domain?: string;
  path?: string;
  gzip?: boolean;
  onWarning?: (message: string) => void;
};

/** Generate every (or one) domain's set onto a disk, inside `Url.withRoot(baseUrl)`. */
export async function generateToDisk(
  config: SitemapConfig,
  options: GenerateToDiskOptions = {},
): Promise<DomainResult[]> {
  const effective: SitemapConfig = options.path
    ? { ...config, path: safeDiskPath(options.path) }
    : config;
  const diskOption = options.disk ?? config.disk ?? "public";
  const disk =
    typeof diskOption === "string" ? Storage.disk(diskOption) : diskOption;
  return generateSitemaps(effective, {
    sinkFor: (domain) => diskSink(disk, domain.directory),
    domain: options.domain,
    gzip: options.gzip,
    scope: routerScope,
    onWarning: options.onWarning,
  });
}

/** Count URLs per domain without writing anything. */
export async function dryRun(
  config: SitemapConfig,
  domainFilter?: string,
): Promise<{ host: string; urls: number }[]> {
  const wanted = domainFilter?.toLowerCase();
  const domains = resolveDomains(config).filter(
    (d) => wanted === undefined || d.host === wanted,
  );
  if (wanted !== undefined && domains.length === 0) {
    throw new Error(`Sitemap domain [${domainFilter}] is not configured.`);
  }
  const out: { host: string; urls: number }[] = [];
  for (const domain of domains) {
    const urls = await routerScope(domain.baseUrl, async () => {
      const sitemap = Sitemap.create({
        baseUrl: domain.baseUrl,
        defaults: config.defaults,
      });
      const built = (await domain.build?.(sitemap, domain)) ?? sitemap;
      let n = 0;
      for await (const _ of built.tags()) n++;
      return n;
    });
    out.push({ host: domain.host, urls });
  }
  return out;
}

export class SitemapGenerateCommand extends Command {
  static signature =
    "sitemap:generate {--domain= : Only this host} {--disk= : Filesystem disk} {--path= : Root file name} {--gzip : gzip split parts} {--dry-run : Count URLs without writing}";
  static description =
    "Generate sitemap.xml (split + index) for each configured domain";

  async handle(): Promise<number> {
    const str = (name: string) => {
      const v = this.option(name);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    try {
      const config = getSitemapConfig();
      const domain = str("domain");
      if (this.option("dry-run") === true) {
        for (const row of await dryRun(config, domain))
          this.info(`${row.host}: ${row.urls} URLs (dry run)`);
        return 0;
      }
      const results = await generateToDisk(config, {
        domain,
        disk: str("disk"),
        path: str("path"),
        gzip: this.option("gzip") === true ? true : undefined,
        onWarning: (m) => this.warn(m),
      });
      for (const { domain: d, result } of results) {
        const files = result.files.length;
        this.info(
          `${d.host}: ${result.urls} URLs → ${d.path}${result.index ? ` (index + ${files} parts)` : ""}`,
        );
      }
      return 0;
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }
}
