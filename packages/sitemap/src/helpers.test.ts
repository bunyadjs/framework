import { describe, expect, test } from "bun:test";
import {
  escapeXml,
  InvalidSitemapUrlError,
  isSameHost,
  resolveLoc,
  stripInvalidXmlChars,
} from "./escape.ts";
import { toW3cDate } from "./date.ts";

describe("escapeXml", () => {
  test("escapes & < > \" '", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });
  test("injection attempt stays text", () => {
    expect(escapeXml("</loc><loc>https://evil")).toBe(
      "&lt;/loc&gt;&lt;loc&gt;https://evil",
    );
  });
  test("strips control chars and lone surrogates, keeps tab/newline and pairs", () => {
    expect(
      stripInvalidXmlChars("a\u0000b\u0008c\u000Bd\u001Fe\tf\ng\uFFFE"),
    ).toBe("abcde\tf\ng");
    expect(stripInvalidXmlChars("x\uD800y\uDC00z")).toBe("xyz");
    expect(escapeXml("😀 اردو 中文")).toBe("😀 اردو 中文");
  });
});

describe("resolveLoc", () => {
  test("absolute URLs pass; relative resolve against baseUrl", () => {
    expect(resolveLoc("https://example.com/a?b=1")).toBe(
      "https://example.com/a?b=1",
    );
    expect(resolveLoc("/posts/1", "https://example.com")).toBe(
      "https://example.com/posts/1",
    );
    expect(resolveLoc("posts", "https://example.com/blog/")).toBe(
      "https://example.com/blog/posts",
    );
  });
  test("normalises what URL() would (host case, dot segments, spaces, bare origin)", () => {
    expect(resolveLoc("https://EXAMPLE.com/a")).toBe("https://example.com/a");
    expect(resolveLoc("https://example.com/a/../b")).toBe(
      "https://example.com/b",
    );
    expect(resolveLoc("https://example.com/a b")).toBe(
      "https://example.com/a%20b",
    );
    expect(resolveLoc("https://example.com")).toBe("https://example.com/");
  });
  test("rejects relative without base, bad schemes, empty, too long", () => {
    expect(() => resolveLoc("/x")).toThrow(InvalidSitemapUrlError);
    expect(() => resolveLoc("javascript:alert(1)")).toThrow(
      InvalidSitemapUrlError,
    );
    expect(() => resolveLoc("data:text/html,x")).toThrow(
      InvalidSitemapUrlError,
    );
    expect(() => resolveLoc("ftp://example.com/x")).toThrow(
      InvalidSitemapUrlError,
    );
    expect(() => resolveLoc("  ")).toThrow(InvalidSitemapUrlError);
    expect(() => resolveLoc(`https://example.com/${"a".repeat(2048)}`)).toThrow(
      InvalidSitemapUrlError,
    );
    expect(resolveLoc(`https://example.com/${"a".repeat(2000)}`)).toHaveLength(
      2020,
    );
  });
  test("isSameHost", () => {
    expect(isSameHost("https://Example.com/a", "example.com")).toBe(true);
    expect(isSameHost("https://example.com:8080/a", "example.com")).toBe(false);
    expect(isSameHost("https://user@evil.com/a", "user")).toBe(false);
    expect(isSameHost("https://shop.example.com/", "example.com")).toBe(false);
  });
});

describe("toW3cDate", () => {
  test("Date, ISO string with offset, epoch ms → UTC +00:00", () => {
    expect(toW3cDate(new Date(Date.UTC(2026, 9, 14, 3, 4, 5)))).toBe(
      "2026-10-14T03:04:05+00:00",
    );
    expect(toW3cDate("2026-10-14T08:00:00+05:00")).toBe(
      "2026-10-14T03:00:00+00:00",
    );
    expect(toW3cDate(0)).toBe("1970-01-01T00:00:00+00:00");
  });
  test("invalid date throws", () => {
    expect(() => toW3cDate("not a date")).toThrow(RangeError);
  });
});
