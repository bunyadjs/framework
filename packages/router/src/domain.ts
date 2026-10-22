/**
 * Hosts outside the app's own domain (custom domains kept in a database) are mapped to a host the
 * route areas already match: `shop.acme.com` -> `acme.example.com` for an area on `{tenant}.{root}`.
 */
type Resolver = (host: string) => string | null | undefined | Promise<string | null | undefined>;

let resolver: Resolver | undefined;
let ttl = 60_000;
let root: string | undefined;
const cache = new Map<string, { host: string | null; expires: number }>();

const hostnameOf = (host: string) => host.split(":")[0]!.toLowerCase();

export const Domain = {
  /**
   * Register how an unknown host is resolved. Return the host to route as (a name under your root
   * domain), or `null` when the host is not served. Answers are cached for `ttl` milliseconds.
   * Return only hosts that are active (verified, not disabled).
   */
  resolver(fn: Resolver, options: { ttl?: number; root?: string } = {}): void {
    resolver = fn;
    ttl = options.ttl ?? 60_000;
    root = options.root;
    cache.clear();
  },

  /** Remove the resolver (tests). */
  clear(): void {
    resolver = undefined;
    cache.clear();
  },

  /** The app's own domain: `APP_DOMAIN`, or the `root` given to `resolver`. */
  root(): string | undefined {
    return (root ?? process.env.APP_DOMAIN)?.toLowerCase();
  },

  /** Whether a resolver is registered. */
  get active(): boolean {
    return resolver !== undefined;
  },

  /** Whether `host` is the app's own domain or a name under it (those never go to the resolver). */
  isOwn(host: string): boolean {
    const own = Domain.root();
    const name = hostnameOf(host);
    return !own || name === own || name.endsWith(`.${own}`) || name === "localhost" || /^[\d.]+$/.test(name);
  },

  /** The host to route `host` as, or `null` when it is not served. Cached. */
  async resolve(host: string): Promise<string | null> {
    if (!resolver) return null;
    const name = hostnameOf(host);
    const hit = cache.get(name);
    if (hit && hit.expires > Date.now()) return hit.host;
    const resolved = (await resolver(name)) ?? null;
    cache.set(name, { host: resolved, expires: Date.now() + ttl });
    return resolved;
  },

  /** Drop the cached answer for a host (after a domain is verified or disabled), or all of them. */
  forget(host?: string): void {
    if (host) cache.delete(hostnameOf(host));
    else cache.clear();
  },
};
