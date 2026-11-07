import { describe, expect, test } from "bun:test";
import { UploadedFile } from "./index.ts";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];
const file = (name: string, content: string | number[], claimed = "application/octet-stream") =>
  new UploadedFile(
    new Blob([typeof content === "string" ? content : new Uint8Array(content)], { type: claimed }),
    name,
  );

describe("what an upload really is", () => {
  test("a picture is a picture whatever it is called or claims to be", async () => {
    const upload = file("holiday.txt", PNG, "text/plain");
    expect(await upload.detectedMimeType()).toBe("image/png");
    expect(await upload.detectedExtension()).toBe("png");
    // the client's claims are still available, under their own names
    expect(upload.getClientMimeType()).toStartWith("text/plain");
    expect(upload.getClientOriginalExtension()).toBe("txt");
  });

  test("a page that claims to be a picture is a page", async () => {
    const upload = file("photo.png", "<script>alert(1)</script>", "image/png");
    expect(upload.mimeType).toBe("image/png"); // what it said
    expect(await upload.detectedMimeType()).toBe("text/html"); // what it is
    expect(await upload.detectedExtension()).toBe("html");
  });

  test("plain text has no detected type", async () => {
    const upload = file("notes.txt", "just words", "text/plain");
    expect(await upload.detectedMimeType()).toBeNull();
    expect(await upload.detectedExtension()).toBeNull();
  });

  test("only the start of a large file is read to find its type", async () => {
    const big = new Uint8Array(20 * 1024 * 1024);
    big.set(PNG);
    const upload = new UploadedFile(new Blob([big]), "big.png");
    const started = performance.now();
    expect(await upload.detectedMimeType()).toBe("image/png");
    expect(performance.now() - started).toBeLessThan(250);
  });

  test("the answer is remembered", async () => {
    const upload = file("a.png", PNG);
    expect(await upload.detectedMimeType()).toBe(await upload.detectedMimeType());
  });
});

describe("isSafeSvg", () => {
  test("a plain SVG is safe, a scripted one is not", async () => {
    expect(await file("a.svg", '<svg xmlns="x"><rect/></svg>').isSafeSvg()).toBe(true);
    expect(await file("a.svg", '<svg xmlns="x"><script>1</script></svg>').isSafeSvg()).toBe(false);
  });

  test("a file that is not an SVG is not a safe SVG", async () => {
    expect(await file("a.svg", "hello").isSafeSvg()).toBe(false);
    expect(await file("a.png", PNG).isSafeSvg()).toBe(false);
  });

  test("an SVG over the size limit is not read and is not safe", async () => {
    const huge = `<svg>${" ".repeat(2 * 1024 * 1024)}</svg>`;
    expect(await file("a.svg", huge).isSafeSvg()).toBe(false);
  });
});
