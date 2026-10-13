import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystem, MemoryFilesystem } from "./index.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bunyad-ws-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function* repeat(chunk: Uint8Array, times: number) {
  for (let i = 0; i < times; i++) yield chunk;
}

describe("LocalFilesystem.writeStream (true streaming)", () => {
  test("writes async iterable chunks in order into nested dirs", async () => {
    const disk = new LocalFilesystem({ root });
    async function* chunks() {
      yield new TextEncoder().encode("ab");
      yield new TextEncoder().encode("cd");
    }
    await disk.writeStream("a/b/s.txt", chunks());
    expect(text(await disk.get("a/b/s.txt"))).toBe("abcd");
    expect(await readdir(join(root, "a/b"))).toEqual(["s.txt"]);
  });

  test("accepts a ReadableStream", async () => {
    const disk = new LocalFilesystem({ root });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello "));
        controller.enqueue(new TextEncoder().encode("world"));
        controller.close();
      },
    });
    await disk.writeStream("r.txt", stream);
    expect(text(await disk.get("r.txt"))).toBe("hello world");
  });

  test("failure mid-stream keeps the previous file and leaves no temp file", async () => {
    const disk = new LocalFilesystem({ root });
    await disk.put("keep.txt", "old");
    async function* broken() {
      yield new TextEncoder().encode("new");
      throw new Error("boom");
    }
    await expect(disk.writeStream("keep.txt", broken())).rejects.toThrow(
      "boom",
    );
    expect(text(await disk.get("keep.txt"))).toBe("old");
    expect(await readdir(root)).toEqual(["keep.txt"]);
  });

  test("rejects path traversal", async () => {
    const disk = new LocalFilesystem({ root });
    await expect(
      disk.writeStream("../x.txt", repeat(new Uint8Array(1), 1)),
    ).rejects.toThrow();
  });

  test("200 MB stream: peak RSS growth independent of payload size", async () => {
    const disk = new LocalFilesystem({ root });
    const chunk = new Uint8Array(1024 * 1024).fill(120);
    Bun.gc(true);
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    async function* sampled() {
      for (let i = 0; i < 200; i++) {
        if (i % 10 === 0) peak = Math.max(peak, process.memoryUsage().rss);
        yield chunk;
      }
    }
    await disk.writeStream("big.bin", sampled());
    peak = Math.max(peak, process.memoryUsage().rss);
    expect((await stat(join(root, "big.bin"))).size).toBe(200 * 1024 * 1024);
    const growthMb = (peak - baseline) / 1024 / 1024;
    // Buffering would need >= 400 MB (chunks + merged copy).
    expect(growthMb).toBeLessThan(64);
  }, 60_000);
});

describe("MemoryFilesystem.writeStream (unchanged buffered fallback)", () => {
  test("stores concatenated chunks", async () => {
    const disk = new MemoryFilesystem();
    await disk.writeStream("m.txt", repeat(new TextEncoder().encode("x"), 3));
    expect(text(await disk.get("m.txt"))).toBe("xxx");
  });
});
