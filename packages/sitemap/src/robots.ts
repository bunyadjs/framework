/**
 * robots.txt helpers (`@bunyad/sitemap/robots`, SPEC D6). No Bunyad peers.
 */
import {
  resolveDomains,
  type RobotsRule,
  type SitemapConfig,
} from "./domains.ts";

function clean(value: string): string {
  // One directive per line: never let input inject extra lines.
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** `Sitemap: https://…/sitemap.xml` */
export function robotsSitemapLine(url: string): string {
  return `Sitemap: ${clean(url)}`;
}

type Group = { agents: string[]; lines: string[] };

export class RobotsBuilder {
  #groups: Group[] = [];
  #sitemaps: string[] = [];

  #group(): Group {
    let group = this.#groups[this.#groups.length - 1];
    if (!group) {
      group = { agents: ["*"], lines: [] };
      this.#groups.push(group);
    }
    return group;
  }

  /** Start a group (consecutive calls before any rule share one group). */
  userAgent(agent: string): this {
    const last = this.#groups[this.#groups.length - 1];
    if (last && last.lines.length === 0) last.agents.push(clean(agent));
    else this.#groups.push({ agents: [clean(agent)], lines: [] });
    return this;
  }

  allow(path: string): this {
    this.#group().lines.push(`Allow: ${clean(path)}`);
    return this;
  }

  disallow(path: string): this {
    this.#group().lines.push(`Disallow: ${clean(path)}`);
    return this;
  }

  sitemap(url: string): this {
    if (!this.#sitemaps.includes(url)) this.#sitemaps.push(url);
    return this;
  }

  rule(rule: RobotsRule): this {
    for (const agent of Array.isArray(rule.userAgent)
      ? rule.userAgent
      : [rule.userAgent]) {
      this.userAgent(agent);
    }
    for (const path of rule.allow ?? []) this.allow(path);
    for (const path of rule.disallow ?? []) this.disallow(path);
    return this;
  }

  toString(): string {
    const blocks = this.#groups.map((g) =>
      [...g.agents.map((a) => `User-agent: ${a}`), ...g.lines].join("\n"),
    );
    if (this.#sitemaps.length > 0)
      blocks.push(this.#sitemaps.map(robotsSitemapLine).join("\n"));
    return blocks.join("\n\n") + "\n";
  }
}

export function robots(): RobotsBuilder {
  return new RobotsBuilder();
}

/**
 * robots.txt for the configured rules plus one `Sitemap:` line per domain,
 * or only `host`'s line when given (host-scoped robots.txt).
 */
export function robotsFor(config: SitemapConfig, host?: string): string {
  const builder = robots();
  const rules = config.robots?.rules ?? [{ userAgent: "*", allow: ["/"] }];
  for (const rule of rules) builder.rule(rule);
  const wanted = host?.toLowerCase();
  for (const domain of resolveDomains(config)) {
    if (wanted === undefined || domain.host === wanted)
      builder.sitemap(domain.sitemapUrl);
  }
  return builder.toString();
}
