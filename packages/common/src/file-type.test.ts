import { describe, expect, test } from "bun:test";
import { detectFileType, isSafeSvg } from "./index.ts";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "rest of the file");

describe("detectFileType reads the bytes, whatever the file is called", () => {
  test.each([
    ["png", PNG, "image/png", "png"],
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], "JFIF"), "image/jpeg", "jpg"],
    ["gif 89a", bytes("GIF89a", [1, 0, 1, 0]), "image/gif", "gif"],
    ["gif 87a", bytes("GIF87a", [1, 0, 1, 0]), "image/gif", "gif"],
    ["webp", bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "image/webp", "webp"],
    ["bmp", bytes("BM", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "image/bmp", "bmp"],
    ["ico", bytes([0, 0, 1, 0, 1, 0], "icon data"), "image/x-icon", "ico"],
    ["avif", bytes([0, 0, 0, 0x1c], "ftypavif", [0, 0, 0, 0]), "image/avif", "avif"],
    ["pdf", bytes("%PDF-1.7\n"), "application/pdf", "pdf"],
    ["zip", bytes([0x50, 0x4b, 0x03, 0x04], "more"), "application/zip", "zip"],
    ["gzip", bytes([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0]), "application/gzip", "gz"],
    ["mp4", bytes([0, 0, 0, 0x18], "ftypisom", [0, 0, 0, 0]), "video/mp4", "mp4"],
    ["webm", bytes([0x1a, 0x45, 0xdf, 0xa3], "matroska"), "video/webm", "webm"],
    ["mp3 with a tag", bytes("ID3", [3, 0, 0, 0, 0, 0, 0]), "audio/mpeg", "mp3"],
    ["wav", bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "), "audio/wav", "wav"],
  ])("%s", (_name, data, mime, extension) => {
    expect(detectFileType(data)).toEqual({ mime, extension });
  });

  test("an SVG, with or without a prolog, comments, a doctype or a byte order mark", () => {
    const svg = { mime: "image/svg+xml", extension: "svg" };
    expect(detectFileType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toEqual(svg);
    expect(detectFileType(bytes('<?xml version="1.0"?>\n<svg></svg>'))).toEqual(svg);
    expect(detectFileType(bytes("<!-- made by hand -->\n<svg></svg>"))).toEqual(svg);
    expect(detectFileType(bytes('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x"><svg></svg>'))).toEqual(svg);
    expect(detectFileType(bytes([0xef, 0xbb, 0xbf], "  <svg></svg>"))).toEqual(svg);
  });

  test("a web page is recognised as one, so it can be refused as a picture", () => {
    const html = { mime: "text/html", extension: "html" };
    expect(detectFileType(bytes("<!DOCTYPE html><html></html>"))).toEqual(html);
    expect(detectFileType(bytes("  \n<html><body>x</body></html>"))).toEqual(html);
    expect(detectFileType(bytes("<script>alert(1)</script>"))).toEqual(html);
    expect(detectFileType(bytes("<iframe src=x></iframe>"))).toEqual(html);
  });

  test("other XML is XML", () => {
    expect(detectFileType(bytes('<?xml version="1.0"?><note/>'))).toEqual({ mime: "application/xml", extension: "xml" });
  });

  test("plain text, empty and unknown data have no type", () => {
    expect(detectFileType(bytes("hello world"))).toBeNull();
    expect(detectFileType(bytes("a,b,c\n1,2,3"))).toBeNull();
    expect(detectFileType(bytes('{"a":1}'))).toBeNull();
    expect(detectFileType(new Uint8Array())).toBeNull();
    expect(detectFileType(bytes([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  test("a partial signature is not a match", () => {
    expect(detectFileType(bytes([0x89, 0x50, 0x4e, 0x47]))).toBeNull(); // PNG needs all 8 bytes
    expect(detectFileType(bytes("GIF8"))).toBeNull();
    expect(detectFileType(bytes("RIFF", [0, 0, 0, 0], "AVI "))).toBeNull();
  });

  test("an image with a page appended is still an image; a page with a PNG name is a page", () => {
    expect(detectFileType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "<script>alert(1)</script>"))?.mime).toBe(
      "image/png",
    );
    expect(detectFileType(bytes("<script>alert(1)</script>"))?.mime).toBe("text/html");
  });

  test("accepts a Buffer or a view into a larger one", () => {
    const whole = new Uint8Array([9, 9, ...PNG, 9]);
    expect(detectFileType(whole.subarray(2, 2 + PNG.length))?.mime).toBe("image/png");
    expect(detectFileType(Buffer.from(PNG))?.mime).toBe("image/png");
  });
});

describe("isSafeSvg", () => {
  const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`;

  test("plain shapes, gradients and text are fine", () => {
    expect(isSafeSvg(wrap('<rect width="10" height="10" fill="red"/>'))).toBe(true);
    expect(isSafeSvg(wrap('<linearGradient id="g"><stop offset="0"/></linearGradient><text>Hi</text>'))).toBe(true);
    expect(isSafeSvg(bytes(wrap("<circle r='3'/>")))).toBe(true);
  });

  test.each([
    ["a script element", wrap("<script>alert(1)</script>")],
    ["a script element in odd case and spacing", wrap("< SCRIPT >alert(1)</ SCRIPT >")],
    ["an event handler", wrap('<rect onclick="alert(1)"/>')],
    ["an onload on the root", '<svg onload="alert(1)"></svg>'],
    ["a javascript link", wrap('<a href="javascript:alert(1)"><rect/></a>')],
    ["an iframe", wrap("<iframe src='x'/>")],
    ["an embed", wrap("<embed src='x'/>")],
    ["an object", wrap("<object data='x'/>")],
    ["an entity definition", '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>'],
    ["embedded HTML", wrap("<foreignObject><div>hi</div></foreignObject>")],
    ["an html data link", wrap('<a href="data:text/html;base64,PHNjcmlwdD4="><rect/></a>')],
  ])("refuses %s", (_name, svg) => {
    expect(isSafeSvg(svg)).toBe(false);
  });

  test("anything that is not an SVG is not a safe SVG", () => {
    expect(isSafeSvg("hello")).toBe(false);
    expect(isSafeSvg("<html></html>")).toBe(false);
    expect(isSafeSvg(PNG)).toBe(false);
    expect(isSafeSvg("")).toBe(false);
  });
});
