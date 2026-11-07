/**
 * What a file really is, from its own bytes.
 *
 * A browser sends a name and a type with every upload, and both are whatever the sender wrote. These
 * functions look at the content instead, so a web page called `photo.png`, or an SVG that carries a
 * script, is recognised for what it is.
 */

export type DetectedFileType = { mime: string; extension: string };

const text = (value: string): number[] => Array.from(value, (c) => c.charCodeAt(0));

function at(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = text("GIF87a");
const GIF89 = text("GIF89a");
const RIFF = text("RIFF");
const WEBP = text("WEBP");
const WAVE = text("WAVE");
const BMP = text("BM");
const ICO = [0x00, 0x00, 0x01, 0x00];
const PDF = text("%PDF-");
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const GZIP = [0x1f, 0x8b];
const FTYP = text("ftyp");
const AVIF_BRANDS = [text("avif"), text("avis")];
const EBML = [0x1a, 0x45, 0xdf, 0xa3];
const ID3 = text("ID3");

/** The text at the start of a file: byte order mark and leading space removed. */
function leadingText(bytes: Uint8Array): string {
  const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 1024));
  return head.replace(/^﻿/, "").trimStart();
}

/** `<svg ...>` after an optional XML prolog, comments and a simple doctype. */
const SVG_START = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg[^>[]*>\s*)?<svg[\s>]/i;

/** Markup a browser would run as a page. */
const HTML_START =
  /^<(?:!doctype\s+html|html|head|body|script|iframe|object|embed|meta|title|style|link|a\s|div|span|p[\s>]|img\s|form|input|table|h[1-6][\s>])/i;

/**
 * The type of a file, or `null` when it has no signature (plain text, CSV, JSON, unknown data).
 * Raster pictures, PDF, ZIP, GZIP, common audio and video, SVG, web pages and XML are recognised.
 * Only the first kilobyte is looked at for text formats, and a few bytes for the rest.
 */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (bytes.length === 0) return null;
  if (at(bytes, 0, PNG)) return { mime: "image/png", extension: "png" };
  if (at(bytes, 0, JPEG)) return { mime: "image/jpeg", extension: "jpg" };
  if (at(bytes, 0, GIF87) || at(bytes, 0, GIF89)) return { mime: "image/gif", extension: "gif" };
  if (at(bytes, 0, RIFF)) {
    if (at(bytes, 8, WEBP)) return { mime: "image/webp", extension: "webp" };
    if (at(bytes, 8, WAVE)) return { mime: "audio/wav", extension: "wav" };
    return null;
  }
  if (at(bytes, 0, PDF)) return { mime: "application/pdf", extension: "pdf" };
  if (at(bytes, 0, ZIP)) return { mime: "application/zip", extension: "zip" };
  if (at(bytes, 0, GZIP)) return { mime: "application/gzip", extension: "gz" };
  if (at(bytes, 4, FTYP)) {
    return AVIF_BRANDS.some((brand) => at(bytes, 8, brand))
      ? { mime: "image/avif", extension: "avif" }
      : { mime: "video/mp4", extension: "mp4" };
  }
  if (at(bytes, 0, EBML)) return { mime: "video/webm", extension: "webm" };
  if (at(bytes, 0, ID3)) return { mime: "audio/mpeg", extension: "mp3" };
  if (bytes.length > 6 && at(bytes, 0, ICO)) return { mime: "image/x-icon", extension: "ico" };
  if (bytes.length > 10 && at(bytes, 0, BMP)) return { mime: "image/bmp", extension: "bmp" };

  const head = leadingText(bytes);
  if (SVG_START.test(head)) return { mime: "image/svg+xml", extension: "svg" };
  if (HTML_START.test(head)) return { mime: "text/html", extension: "html" };
  if (/^<\?xml/i.test(head)) return { mime: "application/xml", extension: "xml" };
  return null;
}

/** Anything in an SVG that runs code, embeds a page, or defines entities. */
const SVG_UNSAFE =
  /<\s*script\b|\son[a-z]+\s*=|javascript\s*:|<\s*(?:iframe|embed|object|foreignObject)\b|<!ENTITY|data\s*:\s*text\/html/i;

/** The largest SVG that is read to be checked; a bigger one is not accepted. */
const MAX_SVG_BYTES = 1024 * 1024;

/**
 * Whether the content is an SVG with nothing in it that runs code or embeds a page: no script
 * element, event handler attribute, `javascript:` link, `iframe`/`embed`/`object`/`foreignObject`,
 * HTML data link or entity definition. Plain shapes, gradients and text pass. Anything that is not
 * an SVG, and anything over 1 MB, does not.
 */
export function isSafeSvg(input: string | Uint8Array): boolean {
  const size = typeof input === "string" ? input.length : input.length;
  if (size === 0 || size > MAX_SVG_BYTES) return false;
  const body = typeof input === "string" ? input : new TextDecoder("utf-8").decode(input);
  const trimmed = body.replace(/^﻿/, "").trimStart();
  return SVG_START.test(trimmed) && !SVG_UNSAFE.test(trimmed);
}
