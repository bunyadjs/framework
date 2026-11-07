/**
 * Headers for serving a stored file to a browser.
 *
 * A file is only shown inline when its type is known to be inert. Anything that can carry script
 * (a page, an SVG, XML, JavaScript) or that is not known at all is sent as a download instead, so
 * opening its link cannot run code on the application's origin. Every file is sent with
 * `X-Content-Type-Options: nosniff`, so the browser cannot decide it is something else.
 */

/** Types that are shown inline by default: raster pictures, plain text and PDF. */
const INLINE_SAFE = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "text/plain",
  "application/pdf",
]);

/**
 * Types shown by the browser's own viewer. A `sandbox` policy stops that viewer from opening them,
 * so they are sent without one.
 */
function usesBrowserViewer(type: string): boolean {
  return type === "application/pdf" || type.startsWith("audio/") || type.startsWith("video/");
}

export type SafeServeOptions = {
  /** Show any type inline when asked to. Use it only for files you produced yourself. */
  inlineUnsafe?: boolean;
  /** More types to show inline, such as `video/mp4`. */
  inlineTypes?: readonly string[];
};

export type FileHeaders = {
  "Content-Disposition": string;
  "X-Content-Type-Options": "nosniff";
  /** Absent for types the browser shows with its own viewer. */
  "Content-Security-Policy"?: string;
};

/** `image/png; charset=x` to `image/png`. */
function bareType(mime: string): string {
  return mime.split(";")[0]!.trim().toLowerCase();
}

/** Whether a file of this type may be shown inline without further say-so. */
export function isInlineSafe(mime: string, options: SafeServeOptions = {}): boolean {
  const type = bareType(mime);
  return INLINE_SAFE.has(type) || (options.inlineTypes ?? []).some((extra) => bareType(extra) === type);
}

/**
 * `Content-Disposition` value for a download name. The quoted name is a safe ASCII fallback;
 * names with quotes, backslashes, control or non-ASCII characters also get an encoded
 * `filename*` so the caller can never terminate the parameter and add their own.
 */
export function contentDisposition(disposition: string, filename: string): string {
  const plain = /^[\x20-\x7e]*$/.test(filename) && !/["\\]/.test(filename);
  if (plain) return `${disposition}; filename="${filename}"`;
  const fallback = filename.replace(/[^A-Za-z0-9 ._-]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * The safe headers for a file of `mime`, for code that builds its own response.
 * `disposition: "inline"` (the default) is downgraded to a download for a type that is not known to
 * be inert; `"attachment"` is always honoured.
 */
export function fileHeaders(
  mime: string,
  options: SafeServeOptions & { filename?: string; disposition?: string } = {},
): FileHeaders {
  const type = bareType(mime);
  const asked = options.disposition ?? "inline";
  const inline = asked === "inline" && (options.inlineUnsafe === true || isInlineSafe(type, options));
  const disposition = inline ? "inline" : asked === "inline" ? "attachment" : asked;
  const headers: FileHeaders = {
    "Content-Disposition":
      options.filename === undefined ? disposition : contentDisposition(disposition, options.filename),
    "X-Content-Type-Options": "nosniff",
  };
  if (!(inline && usesBrowserViewer(type))) {
    headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
  }
  return headers;
}
