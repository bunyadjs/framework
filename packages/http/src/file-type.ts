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
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const QUICKTIME = text("qt  ");
const M4A_BRANDS = [text("M4A "), text("M4B ")];
const HEIC_BRANDS = [text("heic"), text("heix"), text("hevc"), text("mif1"), text("msf1")];
/** Sizes of the DIB header that follows a BMP file header. */
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

/** `BM`, a size, four reserved zero bytes, then a known header size: a CSV that starts `BM` is not a BMP. */
function isBmp(bytes: Uint8Array): boolean {
  if (bytes.length < 18 || !at(bytes, 0, BMP)) return false;
  if (bytes[6] !== 0 || bytes[7] !== 0 || bytes[8] !== 0 || bytes[9] !== 0) return false;
  const size = bytes[14]! | (bytes[15]! << 8) | (bytes[16]! << 16) | (bytes[17]! << 24);
  return BMP_HEADER_SIZES.has(size);
}

/** MPEG audio frame header: 11 sync bits, a valid version and layer, a valid bitrate and sample rate. */
function isMpegAudioFrame(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || (bytes[1]! & 0xe0) !== 0xe0) return false;
  const version = (bytes[1]! >> 3) & 0x03;
  const layer = (bytes[1]! >> 1) & 0x03;
  const bitrate = (bytes[2]! >> 4) & 0x0f;
  const sampleRate = (bytes[2]! >> 2) & 0x03;
  return version !== 1 && layer !== 0 && bitrate !== 0 && bitrate !== 15 && sampleRate !== 3;
}

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
    if (AVIF_BRANDS.some((brand) => at(bytes, 8, brand))) return { mime: "image/avif", extension: "avif" };
    if (HEIC_BRANDS.some((brand) => at(bytes, 8, brand))) return { mime: "image/heic", extension: "heic" };
    if (at(bytes, 8, QUICKTIME)) return { mime: "video/quicktime", extension: "mov" };
    if (M4A_BRANDS.some((brand) => at(bytes, 8, brand))) return { mime: "audio/mp4", extension: "m4a" };
    return { mime: "video/mp4", extension: "mp4" };
  }
  if (at(bytes, 0, OLE)) return { mime: "application/x-ole-storage", extension: "doc" };
  if (isMpegAudioFrame(bytes)) return { mime: "audio/mpeg", extension: "mp3" };
  if (at(bytes, 0, EBML)) return { mime: "video/webm", extension: "webm" };
  if (at(bytes, 0, ID3)) return { mime: "audio/mpeg", extension: "mp3" };
  if (bytes.length > 6 && at(bytes, 0, ICO)) return { mime: "image/x-icon", extension: "ico" };
  if (isBmp(bytes)) return { mime: "image/bmp", extension: "bmp" };

  const head = leadingText(bytes);
  if (SVG_START.test(head)) return { mime: "image/svg+xml", extension: "svg" };
  if (HTML_START.test(head)) return { mime: "text/html", extension: "html" };
  if (/^<\?xml/i.test(head)) return { mime: "application/xml", extension: "xml" };
  return null;
}
