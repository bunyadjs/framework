/**
 * XML escaping + `<loc>` validation (sitemaps.org 0.9).
 */

// Chars not allowed in XML 1.0 (C0 controls except TAB/LF/CR, U+FFFE/U+FFFF, lone surrogates).
const INVALID_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const NEEDS_ESCAPE = /[&<>"']/;
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** Remove characters that cannot appear in an XML 1.0 document. */
export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML, "");
}

/** Escape text or attribute content (`& < > " '`) after stripping invalid chars. */
export function escapeXml(value: string): string {
  const clean = stripInvalidXmlChars(value);
  return NEEDS_ESCAPE.test(clean)
    ? clean.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c)
    : clean;
}

export const MAX_LOC_LENGTH = 2048;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export class InvalidSitemapUrlError extends Error {
  override name = "InvalidSitemapUrlError";
}

/**
 * Resolve and validate a `<loc>`: relative → absolute via `baseUrl`;
 * http(s) only; ≤ 2,048 chars. Returns the normalised absolute URL.
 */
// Already-normalised absolute URLs (lowercase host, explicit path, no dot
// segments, no chars URL() would rewrite) skip the URL parser — hot path.
const FAST_ABSOLUTE =
  /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;

export function resolveLoc(loc: string, baseUrl?: string): string {
  if (
    loc.length <= MAX_LOC_LENGTH &&
    FAST_ABSOLUTE.test(loc) &&
    !loc.includes("/.")
  ) {
    return loc;
  }
  const raw = loc.trim();
  if (raw === "") throw new InvalidSitemapUrlError("Sitemap URL is empty.");
  let parsed: URL;
  try {
    parsed = baseUrl
      ? new URL(raw, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
      : new URL(raw);
  } catch {
    throw new InvalidSitemapUrlError(
      baseUrl
        ? `Invalid sitemap URL [${raw}].`
        : `Sitemap URL [${raw}] is not absolute; set a baseUrl to resolve relative URLs.`,
    );
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new InvalidSitemapUrlError(
      `Sitemap URL [${raw}] must use http or https.`,
    );
  }
  const href = parsed.href;
  if (href.length > MAX_LOC_LENGTH) {
    throw new InvalidSitemapUrlError(
      `Sitemap URL exceeds ${MAX_LOC_LENGTH} characters.`,
    );
  }
  return href;
}

/** True when `loc` is an absolute URL on `host` (hostname[:port], case-insensitive). */
export function isSameHost(loc: string, host: string): boolean {
  return hostOf(loc) === host.toLowerCase();
}

/** Host (hostname[:port], lowercase) of an absolute URL, or "" when unparsable. */
export function hostOf(loc: string): string {
  const start = loc.indexOf("://");
  if (start > 0) {
    const from = start + 3;
    let end = from;
    while (end < loc.length) {
      const c = loc.charCodeAt(end);
      if (c === 47 || c === 63 || c === 35 || c === 64) break; // / ? # @
      end++;
    }
    if (loc.charCodeAt(end) !== 64) return loc.slice(from, end).toLowerCase();
  }
  try {
    return new URL(loc).host.toLowerCase();
  } catch {
    return "";
  }
}
