import {
  BOT_ANY,
  BROWSERS,
  DEVICES,
  HINT_BRANDS,
  HINT_PLATFORMS,
  MOBILE,
  PLATFORMS,
  ROBOTS,
  TABLET,
  WINDOWS_NT,
  type Rule,
} from "./rules.ts";

export type DeviceType = "desktop" | "mobile" | "tablet" | "robot" | "unknown";

export interface ParsedAgent {
  browser: string | false;
  browserVersion: string | false;
  platform: string | false;
  platformVersion: string | false;
  device: string | false;
  deviceType: DeviceType;
  robot: string | false;
}

/** Header source for Client Hints: a lookup function or a plain object (any key case). */
export type HeaderSource =
  | ((name: string) => string | null | undefined)
  | Record<string, string | null | undefined>;

const MAX_LENGTH = 512;

let cacheSize = 1000;
const cache = new Map<string, Readonly<ParsedAgent>>();

/** Set the LRU cache size (default 1000). `0` disables caching. */
export function setAgentCacheSize(size: number): void {
  cacheSize = Math.max(0, size | 0);
  while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
}

/** Empty the parse cache. */
export function clearAgentCache(): void {
  cache.clear();
}

function firstMatch(table: readonly Rule[], ua: string): [string, string | false] | null {
  for (let i = 0; i < table.length; i++) {
    const rule = table[i]!;
    const m = rule[1].exec(ua);
    if (m !== null) {
      for (let g = 1; g < m.length; g++) {
        const v = m[g];
        if (v) return [rule[0], v];
      }
      return [rule[0], false];
    }
  }
  return null;
}

function parse(ua: string): ParsedAgent {
  if (ua === "") {
    return { browser: false, browserVersion: false, platform: false, platformVersion: false, device: false, deviceType: "unknown", robot: false };
  }

  let robot: string | false = false;
  if (BOT_ANY.test(ua)) {
    const r = firstMatch(ROBOTS, ua);
    if (r !== null) robot = r[0];
  }

  const b = firstMatch(BROWSERS, ua);
  const p = firstMatch(PLATFORMS, ua);
  const d = firstMatch(DEVICES, ua);

  const platform = p ? p[0] : false;
  let platformVersion: string | false = p ? p[1] : false;
  if (platformVersion !== false) {
    if (platform === "Windows") platformVersion = WINDOWS_NT[platformVersion] ?? platformVersion;
    else platformVersion = platformVersion.replaceAll("_", ".");
  }

  let deviceType: DeviceType;
  if (robot !== false) deviceType = "robot";
  else if (TABLET.test(ua) || (platform === "Android" && !MOBILE.test(ua))) deviceType = "tablet";
  else if (MOBILE.test(ua)) deviceType = "mobile";
  else deviceType = "desktop";

  return {
    browser: b ? b[0] : false,
    browserVersion: b ? b[1] : false,
    platform,
    platformVersion,
    device: d ? d[0] : false,
    deviceType,
    robot,
  };
}

/** Parse a User-Agent string. Results are frozen and LRU-cached by UA. */
export function parseUserAgent(userAgent: string | null | undefined): Readonly<ParsedAgent> {
  let ua = userAgent ?? "";
  if (ua.length > MAX_LENGTH) ua = ua.slice(0, MAX_LENGTH);
  if (cacheSize === 0) return Object.freeze(parse(ua));

  const hit = cache.get(ua);
  if (hit !== undefined) {
    // Move to most-recent only when it is not already near the front of eviction order.
    if (cache.size > cacheSize >> 1) {
      cache.delete(ua);
      cache.set(ua, hit);
    }
    return hit;
  }
  const result = Object.freeze(parse(ua));
  cache.set(ua, result);
  if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  return result;
}

export function readHeader(source: HeaderSource | undefined, name: string): string | null {
  if (source === undefined) return null;
  if (typeof source === "function") return source(name) ?? null;
  const direct = source[name];
  if (direct != null) return direct;
  const lower = name.toLowerCase();
  for (const key in source) {
    if (key.toLowerCase() === lower) return source[key] ?? null;
  }
  return null;
}

function unquote(value: string): string {
  const v = value.trim();
  return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v;
}

const BRAND = /"([^"]*)"\s*;\s*v\s*=\s*"([^"]*)"/g;

/** Overlay Client Hints (preferred when present) on a parsed UA. */
export function applyClientHints(base: Readonly<ParsedAgent>, headers: HeaderSource | undefined): Readonly<ParsedAgent> {
  const brands = readHeader(headers, "sec-ch-ua");
  const mobile = readHeader(headers, "sec-ch-ua-mobile");
  const platformHint = readHeader(headers, "sec-ch-ua-platform");
  if (brands === null && mobile === null && platformHint === null) return base;

  const out: ParsedAgent = { ...base };

  if (brands !== null && base.robot === false) {
    // Prefer a specific brand (Edge, Opera, Brave...), then Google Chrome, then Chromium; skip GREASE.
    let name: string | null = null;
    let version = "";
    let rank = 0;
    BRAND.lastIndex = 0;
    for (let m = BRAND.exec(brands); m !== null; m = BRAND.exec(brands)) {
      const brand = m[1]!;
      const mapped = HINT_BRANDS[brand];
      if (mapped === undefined) continue;
      const r = brand === "Chromium" ? 1 : brand === "Google Chrome" ? 2 : 3;
      if (r > rank) {
        rank = r;
        name = mapped;
        version = m[2]!;
        if (r === 3) break;
      }
    }
    if (name !== null) {
      const sameMajor = base.browser === name && base.browserVersion !== false && base.browserVersion.split(".")[0] === version.split(".")[0];
      out.browser = name;
      out.browserVersion = sameMajor ? base.browserVersion : version || false;
    }
  }

  if (platformHint !== null) {
    const p = HINT_PLATFORMS[unquote(platformHint).toLowerCase()];
    if (p !== undefined) {
      if (p !== base.platform) out.platformVersion = false;
      out.platform = p;
      const pv = readHeader(headers, "sec-ch-ua-platform-version");
      if (pv !== null) {
        const v = unquote(pv);
        if (p === "Windows") {
          const major = parseInt(v, 10);
          if (major >= 13) out.platformVersion = "11";
          else if (major > 0) out.platformVersion = "10";
        } else if (v !== "") out.platformVersion = v;
      }
    }
  }

  // `?1` beats an inferred tablet (Android without "Mobile"), but not a known tablet device.
  if (mobile !== null && out.deviceType !== "robot") {
    const m = mobile.trim();
    if (m === "?1" && out.device !== "iPad" && out.device !== "Kindle") out.deviceType = "mobile";
    else if (m === "?0" && out.deviceType === "mobile") out.deviceType = "desktop";
  }

  return Object.freeze(out);
}
