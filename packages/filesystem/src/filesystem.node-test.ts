/** Node: the package entry imports without `bun`; LocalFilesystem uses node:fs fallbacks. */
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  LocalFilesystem,
  MemoryFilesystem,
  S3Filesystem,
  StorageManager,
} from "./index.ts";

const dec = new TextDecoder();

describe("LocalFilesystem (node)", () => {
  let root = "";
  let disk: LocalFilesystem;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "bunyad-fs-node-"));
    disk = new LocalFilesystem({ root });
  });
  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("put / get / exists / size / mimeType / delete", async () => {
    await disk.put("a/b.txt", "héllo");
    assert.equal(dec.decode(await disk.get("a/b.txt")), "héllo");
    assert.equal(await disk.exists("a/b.txt"), true);
    assert.equal(await disk.exists("a"), false);
    assert.equal(await disk.size("a/b.txt"), 6);
    assert.equal(await disk.mimeType("a/b.txt"), "text/plain");
    await assert.rejects(disk.get("missing.txt"), /File not found/);
    assert.equal(await disk.delete("a/b.txt"), true);
    assert.equal(await disk.delete("a/b.txt"), false);
  });

  it("writeStream is atomic and leaves no temp files; move and files", async () => {
    async function* chunks() {
      for (let i = 0; i < 100; i++) yield new TextEncoder().encode(`${i},`);
    }
    await disk.writeStream("s/out.txt", chunks());
    assert.match(dec.decode(await disk.get("s/out.txt")), /^0,1,.*,99,$/);
    assert.deepEqual(await readdir(join(root, "s")), ["out.txt"]);
    await disk.move("s/out.txt", "s/moved.txt");
    assert.deepEqual(await disk.files("s"), ["s/moved.txt"]);
  });

  it("rejects traversal", async () => {
    await assert.rejects(disk.put("../escape.txt", "x"));
  });
});

describe("other disks (node)", () => {
  it("MemoryFilesystem and StorageManager", async () => {
    const mem = new MemoryFilesystem();
    await mem.put("x.txt", "1");
    assert.equal(dec.decode(await mem.get("x.txt")), "1");
    assert.equal(typeof StorageManager, "function");
  });

  it("S3Filesystem needs Bun's client unless one is passed", () => {
    assert.throws(() => new S3Filesystem({ bucket: "b" } as never), /S3Client/);
  });
});
