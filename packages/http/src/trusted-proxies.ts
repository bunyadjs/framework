/**
 * Trusted proxy matching.
 *
 * A trusted list is compiled once (when it is set) into lookup tables grouped by prefix length,
 * so checking an address costs one masked lookup per distinct prefix length instead of a parse
 * and a loop over every entry. IPv4 and IPv6 are both supported, and an IPv4 address written as
 * IPv6 (`::ffff:10.0.0.1`) is treated as IPv4.
 */

export type ParsedIp = {
  family: 4 | 6;
  /** IPv4 as an unsigned 32-bit number. */
  v4: number;
  /** IPv6 as a 128-bit number (unused for IPv4). */
  v6: bigint;
  /** The address without brackets, port or zone. */
  text: string;
};

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_ADDRESS_LENGTH = 64;

function parseV4(text: string): number | null {
  const match = V4.exec(text);
  if (!match) return null;
  let out = 0;
  for (let i = 1; i <= 4; i += 1) {
    const part = Number(match[i]);
    if (part > 255) return null;
    out = out * 256 + part;
  }
  return out >>> 0;
}

function parseV6(text: string): bigint | null {
  if (text.length > 45 || !text.includes(":")) return null;
  let body = text;
  let tail: number[] = [];
  // Embedded IPv4 in the last 32 bits (`::ffff:1.2.3.4`).
  const lastColon = body.lastIndexOf(":");
  const embedded = body.slice(lastColon + 1);
  if (embedded.includes(".")) {
    const v4 = parseV4(embedded);
    if (v4 === null) return null;
    tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    body = body.slice(0, lastColon + 1) + "0:0";
  }
  const doubleColon = body.indexOf("::");
  if (doubleColon !== body.lastIndexOf("::")) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  let groups: number[];
  if (doubleColon === -1) {
    const all = toGroups(body);
    if (!all || all.length !== 8) return null;
    groups = all;
  } else {
    const head = toGroups(body.slice(0, doubleColon));
    const rest = toGroups(body.slice(doubleColon + 2));
    if (!head || !rest || head.length + rest.length > 7) return null;
    groups = [...head, ...new Array<number>(8 - head.length - rest.length).fill(0), ...rest];
  }
  if (tail.length === 2) {
    groups[6] = tail[0]!;
    groups[7] = tail[1]!;
  }
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

/**
 * Parse an address as it appears in a connection or an `X-Forwarded-For` entry.
 * Accepts IPv4, IPv6, `[v6]:port`, `v4:port` and a `%zone` suffix. Returns `null` for anything else.
 */
export function parseIp(input: string): ParsedIp | null {
  let text = input.trim();
  if (text.length === 0 || text.length > MAX_ADDRESS_LENGTH) return null;
  if (text.startsWith("[")) {
    const end = text.indexOf("]");
    if (end === -1) return null;
    text = text.slice(1, end);
  } else if (text.indexOf(":") !== -1 && text.indexOf(":") === text.lastIndexOf(":") && text.includes(".")) {
    // `1.2.3.4:5678`
    text = text.slice(0, text.indexOf(":"));
  }
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  const v4 = parseV4(text);
  if (v4 !== null) return { family: 4, v4, v6: 0n, text };
  const v6 = parseV6(text);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) {
    return { family: 4, v4: Number(v6 & 0xffffffffn) >>> 0, v6: 0n, text };
  }
  return { family: 6, v4: 0, v6, text };
}

export type TrustedProxies = {
  /** `"*"`: every connection is trusted. */
  readonly all: boolean;
  matches(address: string): boolean;
};

const V4_MASKS: number[] = [];
for (let bits = 0; bits <= 32; bits += 1) {
  V4_MASKS.push(bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);
}

function v6Mask(bits: number): bigint {
  return bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
}

/** `10.0.0.` style prefixes become CIDR ranges. */
function dottedPrefixToCidr(pattern: string): string | null {
  const parts = pattern.replace(/\.$/, "").split(".");
  if (parts.length < 1 || parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const padded = [...parts, "0", "0", "0"].slice(0, 4);
  return `${padded.join(".")}/${parts.length * 8}`;
}

const NONE: TrustedProxies = { all: false, matches: () => false };
const EVERYONE: TrustedProxies = { all: true, matches: () => true };
const CACHE_LIMIT = 1024;

/** Compile a trusted proxy list. Entries: exact address, `a.b.c.` prefix, or CIDR (IPv4 or IPv6). */
export function compileTrustedProxies(list: readonly string[] | "*"): TrustedProxies {
  if (list === "*") return EVERYONE;
  if (list.length === 0) return NONE;

  const v4ByBits = new Map<number, Set<number>>();
  const v6ByBits = new Map<number, Set<bigint>>();
  const literals = new Set<string>();

  for (const raw of list) {
    const entry = raw.trim();
    if (entry === "") continue;
    if (entry === "*") return EVERYONE;
    const spec = entry.endsWith(".") ? (dottedPrefixToCidr(entry) ?? entry) : entry;
    const slash = spec.indexOf("/");
    const addressPart = slash === -1 ? spec : spec.slice(0, slash);
    const parsed = parseIp(addressPart);
    if (!parsed) {
      literals.add(entry);
      continue;
    }
    const width = parsed.family === 4 ? 32 : 128;
    const bits = slash === -1 ? width : Number(spec.slice(slash + 1));
    if (!Number.isInteger(bits) || bits < 0 || bits > width) {
      literals.add(entry);
      continue;
    }
    if (parsed.family === 4) {
      const set = v4ByBits.get(bits) ?? new Set<number>();
      set.add((parsed.v4 & V4_MASKS[bits]!) >>> 0);
      v4ByBits.set(bits, set);
    } else {
      const set = v6ByBits.get(bits) ?? new Set<bigint>();
      set.add(parsed.v6 & v6Mask(bits));
      v6ByBits.set(bits, set);
    }
  }

  const v4Lengths = [...v4ByBits.keys()];
  const v6Lengths = [...v6ByBits.keys()];
  const v6Masks = new Map(v6Lengths.map((bits) => [bits, v6Mask(bits)] as const));
  const cache = new Map<string, boolean>();

  const lookup = (address: string): boolean => {
    if (literals.has(address)) return true;
    const ip = parseIp(address);
    if (!ip) return false;
    if (ip.family === 4) {
      for (const bits of v4Lengths) {
        if (v4ByBits.get(bits)!.has((ip.v4 & V4_MASKS[bits]!) >>> 0)) return true;
      }
      return false;
    }
    for (const bits of v6Lengths) {
      if (v6ByBits.get(bits)!.has(ip.v6 & v6Masks.get(bits)!)) return true;
    }
    return false;
  };

  return {
    all: false,
    matches(address: string): boolean {
      const hit = cache.get(address);
      if (hit !== undefined) return hit;
      const result = lookup(address);
      if (cache.size >= CACHE_LIMIT) cache.clear();
      cache.set(address, result);
      return result;
    },
  };
}

/** Largest number of `X-Forwarded-For` entries read, counted from the right. */
const MAX_CHAIN = 32;

/**
 * The client address from an `X-Forwarded-For` value: walk from the right, skip addresses that are
 * trusted proxies, and return the first one that is not. A proxy appends the address it saw, so
 * everything to the left of the first untrusted entry was written by the client or by hops the
 * client controls. When every entry is a trusted proxy the left-most is returned. An entry that is
 * not an address stops the walk (`null`), because a proxy only ever appends addresses.
 */
export function clientFromForwardedFor(header: string, trusted: TrustedProxies): string | null {
  const entries = header.split(",");
  const from = Math.max(0, entries.length - MAX_CHAIN);
  let leftMost: string | null = null;
  for (let i = entries.length - 1; i >= from; i -= 1) {
    const entry = entries[i]!.trim();
    if (entry === "") continue;
    const parsed = parseIp(entry);
    if (!parsed) return null;
    if (!trusted.matches(parsed.text)) return parsed.text;
    leftMost = parsed.text;
  }
  return leftMost;
}
