/**
 * Static string helpers.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const Str = {
  /** `Str::of` — returns a thin chainable wrapper. */
  of(value: string): Stringable {
    return new Stringable(String(value ?? ""));
  },

  lower(value: string): string {
    return String(value).toLowerCase();
  },

  upper(value: string): string {
    return String(value).toUpperCase();
  },

  title(value: string): string {
    return String(value)
      .toLowerCase()
      .replace(/(?:^|\s|[-_])\S/g, (c) => c.toUpperCase());
  },

  /** `Str::headline` — Title Case From snake/kebab/studly. */
  headline(value: string): string {
    const spaced = String(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[\-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return Str.title(spaced);
  },

  slug(value: string, separator = "-"): string {
    return String(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, separator)
      .replace(new RegExp(`^${escapeRegExp(separator)}+|${escapeRegExp(separator)}+$`, "g"), "")
      .replace(new RegExp(`${escapeRegExp(separator)}{2,}`, "g"), separator);
  },

  snake(value: string, delimiter = "_"): string {
    return String(value)
      .replace(/([a-z\d])([A-Z])/g, `$1${delimiter}$2`)
      .replace(/[\-\s]+/g, delimiter)
      .toLowerCase();
  },

  camel(value: string): string {
    const studly = Str.studly(value);
    return studly.charAt(0).toLowerCase() + studly.slice(1);
  },

  studly(value: string): string {
    return String(value)
      .replace(/[-_\s]+(.)?/g, (_, c: string | undefined) =>
        c ? c.toUpperCase() : "",
      )
      .replace(/^(.)/, (c) => c.toUpperCase());
  },

  kebab(value: string): string {
    return Str.snake(value, "-");
  },

  limit(value: string, limit = 100, end = "..."): string {
    const s = String(value);
    if (s.length <= limit) return s;
    return s.slice(0, Math.max(0, limit - end.length)) + end;
  },

  words(value: string, words = 100, end = "..."): string {
    const s = String(value).trim();
    const parts = s.split(/\s+/);
    if (parts.length <= words) return s;
    return parts.slice(0, words).join(" ") + end;
  },

  length(value: string): number {
    return String(value).length;
  },

  substr(value: string, start: number, length?: number): string {
    const s = String(value);
    if (length === undefined) return s.slice(start);
    return s.slice(start, start + length);
  },

  contains(haystack: string, needles: string | string[]): boolean {
    const list = Array.isArray(needles) ? needles : [needles];
    return list.some((n) => String(haystack).includes(String(n)));
  },

  containsAll(haystack: string, needles: string[]): boolean {
    return needles.every((n) => String(haystack).includes(String(n)));
  },

  startsWith(haystack: string, needles: string | string[]): boolean {
    const list = Array.isArray(needles) ? needles : [needles];
    return list.some((n) => String(haystack).startsWith(String(n)));
  },

  endsWith(haystack: string, needles: string | string[]): boolean {
    const list = Array.isArray(needles) ? needles : [needles];
    return list.some((n) => String(haystack).endsWith(String(n)));
  },

  before(subject: string, search: string): string {
    const s = String(subject);
    const i = s.indexOf(search);
    return i === -1 ? s : s.slice(0, i);
  },

  beforeLast(subject: string, search: string): string {
    const s = String(subject);
    const i = s.lastIndexOf(search);
    return i === -1 ? s : s.slice(0, i);
  },

  after(subject: string, search: string): string {
    const s = String(subject);
    const i = s.indexOf(search);
    return i === -1 ? s : s.slice(i + search.length);
  },

  afterLast(subject: string, search: string): string {
    const s = String(subject);
    const i = s.lastIndexOf(search);
    return i === -1 ? s : s.slice(i + search.length);
  },

  between(subject: string, from: string, to: string): string {
    return Str.before(Str.after(subject, from), to);
  },

  replace(
    search: string | string[],
    replace: string | string[],
    subject: string,
  ): string {
    let out = String(subject);
    const searches = Array.isArray(search) ? search : [search];
    const replaces = Array.isArray(replace) ? replace : [replace];
    for (let i = 0; i < searches.length; i++) {
      const r = replaces[Math.min(i, replaces.length - 1)] ?? "";
      out = out.split(String(searches[i])).join(String(r));
    }
    return out;
  },

  replaceFirst(search: string, replace: string, subject: string): string {
    const s = String(subject);
    const i = s.indexOf(search);
    if (i === -1) return s;
    return s.slice(0, i) + replace + s.slice(i + search.length);
  },

  replaceLast(search: string, replace: string, subject: string): string {
    const s = String(subject);
    const i = s.lastIndexOf(search);
    if (i === -1) return s;
    return s.slice(0, i) + replace + s.slice(i + search.length);
  },

  is(pattern: string | string[], value: string): boolean {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    return patterns.some((p) => {
      if (p === value) return true;
      const re = new RegExp(
        `^${escapeRegExp(p).replace(/\\\*/g, ".*")}$`,
        "u",
      );
      return re.test(value);
    });
  },

  isUuid(value: string): boolean {
    return UUID_RE.test(String(value));
  },

  isUlid(value: string): boolean {
    return ULID_RE.test(String(value));
  },

  random(length = 16): string {
    const alphabet =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let out = "";
    for (let i = 0; i < length; i++) {
      out += alphabet[bytes[i]! % alphabet.length]!;
    }
    return out;
  },

  uuid(): string {
    return crypto.randomUUID();
  },

  /** Crockford ULID (26 chars). */
  ulid(): string {
    const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    const time = Date.now();
    let out = "";
    let t = time;
    for (let i = 0; i < 10; i++) {
      out = alphabet[t % 32]! + out;
      t = Math.floor(t / 32);
    }
    const rand = crypto.getRandomValues(new Uint8Array(16));
    for (let i = 0; i < 16; i++) {
      out += alphabet[rand[i]! % 32]!;
    }
    return out.slice(0, 26);
  },

  finish(value: string, cap: string): string {
    const s = String(value);
    return s.endsWith(cap) ? s : s + cap;
  },

  start(value: string, prefix: string): string {
    const s = String(value);
    return s.startsWith(prefix) ? s : prefix + s;
  },

  padLeft(value: string, length: number, pad = " "): string {
    return String(value).padStart(length, pad);
  },

  padRight(value: string, length: number, pad = " "): string {
    return String(value).padEnd(length, pad);
  },

  repeat(value: string, times: number): string {
    return String(value).repeat(Math.max(0, times));
  },

  reverse(value: string): string {
    return [...String(value)].reverse().join("");
  },

  squish(value: string): string {
    return String(value).trim().replace(/\s+/g, " ");
  },
};

/** Thin fluent wrapper (`Str::of`). */
export class Stringable {
  constructor(private value: string) {}

  toString(): string {
    return this.value;
  }

  valueOf(): string {
    return this.value;
  }

  lower(): Stringable {
    return Str.of(Str.lower(this.value));
  }

  upper(): Stringable {
    return Str.of(Str.upper(this.value));
  }

  title(): Stringable {
    return Str.of(Str.title(this.value));
  }

  slug(separator = "-"): Stringable {
    return Str.of(Str.slug(this.value, separator));
  }

  snake(delimiter = "_"): Stringable {
    return Str.of(Str.snake(this.value, delimiter));
  }

  camel(): Stringable {
    return Str.of(Str.camel(this.value));
  }

  studly(): Stringable {
    return Str.of(Str.studly(this.value));
  }

  kebab(): Stringable {
    return Str.of(Str.kebab(this.value));
  }

  limit(limit = 100, end = "..."): Stringable {
    return Str.of(Str.limit(this.value, limit, end));
  }

  finish(cap: string): Stringable {
    return Str.of(Str.finish(this.value, cap));
  }

  append(...values: string[]): Stringable {
    return Str.of(this.value + values.join(""));
  }

  prepend(...values: string[]): Stringable {
    return Str.of(values.join("") + this.value);
  }

  toStringValue(): string {
    return this.value;
  }
}
