import { describe, expect, test } from "bun:test";
import { MemoryFilesystem, fileHeaders, isInlineSafe, mimeTypeForPath } from "./index.ts";

async function served(path: string, content: string, disposition?: string, options?: { inlineUnsafe?: boolean; inlineTypes?: string[] }) {
  const disk = new MemoryFilesystem();
  await disk.put(path, content);
  return disk.response(path, undefined, {}, disposition, options);
}

describe("every served file", () => {
  test("is protected from content sniffing", async () => {
    for (const [path, body] of [
      ["pic.png", "x"],
      ["page.html", "<script>alert(1)</script>"],
      ["doc.pdf", "x"],
      ["data.bin", "x"],
    ] as const) {
      expect((await served(path, body)).headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  test("download() is too", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("a.png", "x");
    const response = await disk.download("a.png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
  });
});

describe("types that can run script are never shown inline", () => {
  test.each([
    ["page.html", "text/html"],
    ["page.htm", "text/html"],
    ["logo.svg", "image/svg+xml"],
    ["feed.xml", "application/xml"],
    ["app.js", "text/javascript"],
    ["blob.bin", "application/octet-stream"],
  ])("%s becomes a download", async (path) => {
    const response = await served(path, "<script>alert(1)</script>");
    expect(response.headers.get("Content-Disposition")).toStartWith("attachment");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
  });

  test("an unknown extension is a download too", async () => {
    const response = await served("mystery.zzz", "x");
    expect(response.headers.get("Content-Disposition")).toStartWith("attachment");
  });
});

describe("pictures and documents stay inline", () => {
  test.each([
    ["pic.png", "image/png"],
    ["pic.jpg", "image/jpeg"],
    ["pic.gif", "image/gif"],
    ["pic.webp", "image/webp"],
    ["note.txt", "text/plain"],
  ])("%s", async (path, type) => {
    const response = await served(path, "x");
    expect(response.headers.get("Content-Type")).toStartWith(type);
    expect(response.headers.get("Content-Disposition")).toStartWith("inline");
  });

  test("a picture opened on its own cannot run script or reach the page's data", async () => {
    const response = await served("pic.png", "x");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
  });

  test("a PDF stays inline and is not sandboxed, because a sandbox stops the browser's PDF viewer", async () => {
    const response = await served("doc.pdf", "x");
    expect(response.headers.get("Content-Disposition")).toStartWith("inline");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("what the caller can change", () => {
  test("headers the caller sets win", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("page.html", "<p>x</p>");
    const response = await disk.response("page.html", undefined, {
      "Content-Disposition": "attachment; filename=custom",
      "Content-Security-Policy": "default-src 'self'",
      "X-Content-Type-Options": "custom",
    });
    expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=custom");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("custom");
  });

  test("inlineUnsafe allows a page to be shown inline, still without sniffing", async () => {
    const response = await served("page.html", "<p>x</p>", "inline", { inlineUnsafe: true });
    expect(response.headers.get("Content-Disposition")).toStartWith("inline");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("inlineTypes adds a type to the inline list", async () => {
    const without = await served("clip.mp4", "x");
    const withType = await served("clip.mp4", "x", "inline", { inlineTypes: ["video/mp4"] });
    expect(without.headers.get("Content-Disposition")).toStartWith("attachment");
    expect(withType.headers.get("Content-Disposition")).toStartWith("inline");
  });

  test("asking for an attachment is always honoured", async () => {
    const response = await served("pic.png", "x", "attachment");
    expect(response.headers.get("Content-Disposition")).toStartWith("attachment");
  });
});

describe("the helpers", () => {
  test("isInlineSafe ignores case and parameters", () => {
    expect(isInlineSafe("IMAGE/PNG")).toBe(true);
    expect(isInlineSafe("text/plain; charset=utf-8")).toBe(true);
    expect(isInlineSafe("text/html")).toBe(false);
    expect(isInlineSafe("text/html; charset=utf-8")).toBe(false);
    expect(isInlineSafe("image/svg+xml")).toBe(false);
    expect(isInlineSafe("")).toBe(false);
    expect(isInlineSafe("application/octet-stream")).toBe(false);
  });

  test("fileHeaders gives the headers for a type, for code that builds its own response", () => {
    const picture = fileHeaders("image/png", { filename: "a.png" });
    expect(picture["Content-Disposition"]).toBe('inline; filename="a.png"');
    expect(picture["X-Content-Type-Options"]).toBe("nosniff");
    const page = fileHeaders("text/html", { filename: "a.html" });
    expect(page["Content-Disposition"]).toBe('attachment; filename="a.html"');
  });

  test("a file name cannot add its own parameters", () => {
    const headers = fileHeaders("image/png", { filename: 'a".png; filename*=UTF-8\'\'evil.exe' });
    expect(headers["Content-Disposition"].match(/filename\*=/g)).toHaveLength(1);
  });

  test("with no file name, no filename parameter is written", () => {
    expect(fileHeaders("image/png")["Content-Disposition"]).toBe("inline");
  });
});

describe("one MIME table for every disk", () => {
  test("common types are known, case does not matter, and unknown ones are octet-stream", () => {
    expect(mimeTypeForPath("a/b.PNG")).toBe("image/png");
    expect(mimeTypeForPath("logo.svg")).toBe("image/svg+xml");
    expect(mimeTypeForPath("page.html")).toBe("text/html");
    expect(mimeTypeForPath("clip.mp4")).toBe("video/mp4");
    expect(mimeTypeForPath("archive.tar.zzz")).toBe("application/octet-stream");
    expect(mimeTypeForPath("noextension")).toBe("application/octet-stream");
  });

  test("a disk reports a picture format it used to not know", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("logo.svg", "<svg/>");
    expect(await disk.mimeType("logo.svg")).toBe("image/svg+xml");
  });
});
