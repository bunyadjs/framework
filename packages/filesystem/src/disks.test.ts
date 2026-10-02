import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  LocalFilesystem,
  MemoryFilesystem,
  Storage,
  StorageFake,
  StorageManager,
  setStorage,
} from "./index.ts";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let base: string;
let root: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "bunyad-fs-"));
  root = join(base, "disk");
  await mkdir(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("LocalFilesystem", () => {
  test("put creates parent directories and overwrites; bytes round-trip", async () => {
    const disk = new LocalFilesystem({ root });
    await disk.put("a/b/c.bin", new Uint8Array([0, 1, 255]));
    expect([...(await disk.get("a/b/c.bin"))]).toEqual([0, 1, 255]);
    await disk.put("a/b/c.bin", "text");
    expect(text(await disk.get("a/b/c.bin"))).toBe("text");
    await disk.put("empty.txt", "");
    expect(await disk.exists("empty.txt")).toBe(true);
    expect((await disk.get("empty.txt")).byteLength).toBe(0);
  });

  test("get and copy of a missing file fail with a clear message", async () => {
    const disk = new LocalFilesystem({ root });
    await expect(disk.get("nope.txt")).rejects.toThrow("File not found: [nope.txt]");
    await expect(disk.copy("nope.txt", "other.txt")).rejects.toThrow("File not found");
    expect(await disk.exists("other.txt")).toBe(false);
  });

  test("delete reports whether anything was removed, and ignores directories", async () => {
    const disk = new LocalFilesystem({ root });
    expect(await disk.delete("ghost.txt")).toBe(false);
    await disk.put("dir/f.txt", "x");
    expect(await disk.delete("dir")).toBe(false);
    expect(await disk.exists("dir/f.txt")).toBe(true);
    expect(await disk.delete("dir/f.txt")).toBe(true);
  });

  test("copy keeps the source; move removes it, creates folders and replaces the target", async () => {
    const disk = new LocalFilesystem({ root });
    await disk.put("src.txt", "one");
    await disk.put("dest/existing.txt", "old");
    await disk.copy("src.txt", "copy/src.txt");
    expect(await disk.exists("src.txt")).toBe(true);
    expect(text(await disk.get("copy/src.txt"))).toBe("one");

    await disk.move("src.txt", "dest/existing.txt");
    expect(await disk.exists("src.txt")).toBe(false);
    expect(text(await disk.get("dest/existing.txt"))).toBe("one");
  });

  test("moving a missing file rejects and does not create the target", async () => {
    const disk = new LocalFilesystem({ root });
    await expect(disk.move("ghost.txt", "x/y.txt")).rejects.toThrow("File not found");
    expect(await disk.exists("x/y.txt")).toBe(false);
  });

  test("size is bytes (not characters), and zero for a missing file", async () => {
    const disk = new LocalFilesystem({ root });
    await disk.put("utf8.txt", "héllo");
    expect(await disk.size("utf8.txt")).toBe(6);
    expect(await disk.size("missing.txt")).toBe(0);
  });

  test("lastModified returns whole seconds and throws for a missing file", async () => {
    const disk = new LocalFilesystem({ root });
    await disk.put("f.txt", "x");
    await utimes(join(root, "f.txt"), 1_700_000_000, 1_700_000_123.9);
    expect(await disk.lastModified("f.txt")).toBe(1_700_000_123);
    await expect(disk.lastModified("missing.txt")).rejects.toThrow();
  });

  test("mimeType falls back to the extension map, case-insensitively, then octet-stream", async () => {
    const disk = new LocalFilesystem({ root });
    await disk.put("a.WEBP", "x");
    await disk.put("b.unknownext", "x");
    expect(await disk.mimeType("a.WEBP")).toBe("image/webp");
    expect(await disk.mimeType("b.unknownext")).toBe("application/octet-stream");
  });

  test("listing: files vs allFiles, directories vs allDirectories, leading and trailing slashes", async () => {
    const disk = new LocalFilesystem({ root });
    await disk.put("top.txt", "1");
    await disk.put("docs/a.md", "1");
    await disk.put("docs/deep/b.md", "1");
    await disk.put("docs/deep/er/c.md", "1");

    expect(await disk.files()).toEqual(["top.txt"]);
    expect(await disk.files("/docs/")).toEqual(["docs/a.md"]);
    expect(await disk.allFiles("docs")).toEqual(["docs/a.md", "docs/deep/b.md", "docs/deep/er/c.md"]);
    expect(await disk.directories("docs")).toEqual(["docs/deep"]);
    expect(await disk.allDirectories()).toEqual(["docs", "docs/deep", "docs/deep/er"]);
    expect(await disk.allDirectories("docs/deep")).toEqual(["docs/deep/er"]);
  });

  test("listing a directory that does not exist yields an empty array", async () => {
    const disk = new LocalFilesystem({ root });
    expect(await disk.files("nope")).toEqual([]);
    expect(await disk.allFiles("nope")).toEqual([]);
    expect(await disk.directories("nope")).toEqual([]);
    expect(await disk.allDirectories("nope")).toEqual([]);
  });

  test("directory helpers: make, exists (file is not a directory), delete recursively", async () => {
    const disk = new LocalFilesystem({ root });
    expect(await disk.makeDirectory("x/y/z")).toBe(true);
    expect(await disk.directoryExists("x/y")).toBe(true);
    await disk.put("x/file.txt", "1");
    expect(await disk.directoryExists("x/file.txt")).toBe(false);
    expect(await disk.deleteDirectory("x")).toBe(true);
    expect(await disk.directoryMissing("x")).toBe(true);
    // deleting something that is not there is not an error
    expect(await disk.deleteDirectory("never-existed")).toBe(true);
  });

  test("url() joins the prefix without duplicate slashes, or is root-relative without one", () => {
    expect(new LocalFilesystem({ root, url: "/storage/" }).url("/a/b.txt")).toBe("/storage/a/b.txt");
    expect(new LocalFilesystem({ root, url: "https://cdn.test" }).url("a.txt")).toBe("https://cdn.test/a.txt");
    expect(new LocalFilesystem({ root }).url("a.txt")).toBe("/a.txt");
  });

  test("path() returns the root, or the resolved absolute file path", () => {
    const disk = new LocalFilesystem({ root });
    expect(disk.path()).toBe(root);
    expect(disk.path("a/../b.txt")).toBe(join(root, "b.txt"));
  });

  test("temporary URLs are not supported and say so", async () => {
    const disk = new LocalFilesystem({ root });
    expect(disk.providesTemporaryUrls()).toBe(false);
    expect(disk.providesTemporaryUploadUrls()).toBe(false);
    await expect(disk.temporaryUrl("a.txt", new Date(0))).rejects.toThrow("temporary URLs");
    await expect(disk.temporaryUploadUrl("a.txt")).rejects.toThrow("temporary upload URLs");
  });

  describe("path traversal", () => {
    test("every path-taking operation rejects escapes", async () => {
      const disk = new LocalFilesystem({ root });
      await disk.put("ok.txt", "x");
      const escape = "../outside.txt";
      await expect(disk.put(escape, "x")).rejects.toThrow(/Path traversal/);
      await expect(disk.get(escape)).rejects.toThrow(/Path traversal/);
      await expect(disk.exists(escape)).rejects.toThrow(/Path traversal/);
      await expect(disk.delete(escape)).rejects.toThrow(/Path traversal/);
      await expect(disk.size(escape)).rejects.toThrow(/Path traversal/);
      await expect(disk.copy("ok.txt", escape)).rejects.toThrow(/Path traversal/);
      await expect(disk.copy(escape, "ok2.txt")).rejects.toThrow(/Path traversal/);
      await expect(disk.move("ok.txt", escape)).rejects.toThrow(/Path traversal/);
      await expect(disk.move(escape, "ok2.txt")).rejects.toThrow(/Path traversal/);
      await expect(disk.makeDirectory("../newdir")).rejects.toThrow(/Path traversal/);
      await expect(disk.deleteDirectory("../")).rejects.toThrow(/Path traversal/);
      await expect(disk.files("../")).rejects.toThrow(/Path traversal/);
      await expect(disk.allFiles("..")).rejects.toThrow(/Path traversal/);
      expect(() => disk.path(escape)).toThrow(/Path traversal/);
      // nothing leaked next to the root, and the original file is intact
      expect(await Bun.file(join(base, "outside.txt")).exists()).toBe(false);
      expect(text(await disk.get("ok.txt"))).toBe("x");
    });

    test("a sibling directory sharing the root's name prefix is still outside", async () => {
      const disk = new LocalFilesystem({ root });
      await mkdir(join(base, "disk-evil"));
      await expect(disk.put("../disk-evil/f.txt", "x")).rejects.toThrow(/Path traversal/);
      expect(await Bun.file(join(base, "disk-evil/f.txt")).exists()).toBe(false);
    });

    test("dot segments that stay inside the root are fine", async () => {
      const disk = new LocalFilesystem({ root });
      await disk.put("a/../b/./c.txt", "x");
      expect(await disk.exists("b/c.txt")).toBe(true);
    });

    test("putFile with a hostile name is rejected instead of escaping the target folder", async () => {
      const disk = new LocalFilesystem({ root });
      await expect(disk.putFileAs("uploads", "x", "../../x.png")).rejects.toThrow(/Path traversal/);
      expect(await disk.putFileAs("uploads", "x", "../ok.png")).toBe("uploads/../ok.png");
      expect(await disk.exists("ok.png")).toBe(true);
    });

    test(
      "a symlink inside the root pointing outside is not followed",
      async () => {
        const disk = new LocalFilesystem({ root });
        const secretDir = join(base, "secret");
        await mkdir(secretDir);
        await writeFile(join(secretDir, "passwd"), "top secret");
        await symlink(secretDir, join(root, "link"));
        await expect(disk.get("link/passwd")).rejects.toThrow();
        await expect(disk.put("link/new.txt", "x")).rejects.toThrow();
      },
    );
  });
});

describe("Disk helpers (shared by every driver)", () => {
  test("append and prepend create a missing file", async () => {
    const disk = new MemoryFilesystem();
    await disk.append("a.txt", "x");
    await disk.prepend("b.txt", "y");
    expect(text(await disk.get("a.txt"))).toBe("x");
    expect(text(await disk.get("b.txt"))).toBe("y");
  });

  test("putFile generates a random 40-char name, or uses hashName() when available", async () => {
    const disk = new MemoryFilesystem();
    const random = await disk.putFile("up", "data");
    expect(random).toMatch(/^up\/[0-9a-f]{40}$/);
    expect(await disk.putFile("up", "data")).not.toBe(random);

    const named = await disk.putFile("", {
      hashName: () => "abc123.png",
      arrayBuffer: async () => new TextEncoder().encode("img").buffer,
    } as never);
    expect(named).toBe("abc123.png");
    expect(text(await disk.get("abc123.png"))).toBe("img");
  });

  test("putFileAs accepts Blob sources and stores visibility only when asked", async () => {
    const disk = new MemoryFilesystem();
    const path = await disk.putFileAs("/up/", new Blob(["blob-bytes"]), "b.txt", "private");
    expect(path).toBe("up/b.txt");
    expect(text(await disk.get(path))).toBe("blob-bytes");
    expect(await disk.getVisibility(path)).toBe("private");

    await disk.putFileAs("up", "x", "c.txt", { visibility: "private" });
    expect(await disk.getVisibility("up/c.txt")).toBe("private");
    await disk.putFileAs("up", "x", "d.txt");
    expect(await disk.getVisibility("up/d.txt")).toBe("public");
  });

  test("putFileAs rejects an unsupported source type", async () => {
    const disk = new MemoryFilesystem();
    await expect(disk.putFileAs("up", 42 as never, "n.txt")).rejects.toThrow("Unsupported file source");
  });

  test("writeStream accepts async iterables and concatenates chunks in order", async () => {
    const disk = new MemoryFilesystem();
    async function* chunks() {
      yield new TextEncoder().encode("ab");
      yield new TextEncoder().encode("cd");
    }
    await disk.writeStream("s.txt", chunks());
    expect(text(await disk.get("s.txt"))).toBe("abcd");
  });

  test("checksum: md5 default, sha1, and sha256 (with or without a dash)", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("f.txt", "abc");
    expect(await disk.checksum("f.txt")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(await disk.checksum("f.txt", "SHA1")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    const sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(await disk.checksum("f.txt", "sha256")).toBe(sha256);
    expect(await disk.checksum("f.txt", "sha-256")).toBe(sha256);
  });

  test("checksum supports other algorithms and rejects unknown ones", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("f.txt", "abc");
    expect(await disk.checksum("f.txt", "sha512")).toHaveLength(128);
    await expect(disk.checksum("f.txt", "not-a-hash")).rejects.toThrow("Unsupported checksum algorithm");
  });

  test("response() keeps caller-supplied headers and defaults the rest", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("doc.pdf", "pdf");
    const defaults = await disk.response("doc.pdf");
    expect(defaults.headers.get("Content-Type")).toBe("application/pdf");
    expect(defaults.headers.get("Content-Disposition")).toBe('inline; filename="doc.pdf"');

    const custom = await disk.download("doc.pdf", "report.pdf", {
      "Content-Type": "text/plain",
      "Content-Disposition": "attachment; filename=custom",
    });
    expect(custom.headers.get("Content-Type")).toBe("text/plain");
    expect(custom.headers.get("Content-Disposition")).toBe("attachment; filename=custom");
    await expect(disk.download("missing.pdf")).rejects.toThrow("does not exist");
  });

  test("download() cannot be tricked into extra Content-Disposition parameters", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("f.txt", "x");
    const res = await disk.download("f.txt", 'a".txt; filename*=UTF-8\'\'evil.exe');
    const header = res.headers.get("Content-Disposition")!;
    expect(header).not.toContain('a".txt');
    expect(header.match(/filename\*=/g)).toHaveLength(1); // only our own encoded one
    expect(header).toContain("filename*=UTF-8''a%22.txt");
    const unicode = await disk.download("f.txt", "résumé.txt");
    expect(unicode.headers.get("Content-Disposition")).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9.txt");
  });

  test("when() and unless() run the matching branch and are chainable", async () => {
    const disk = new MemoryFilesystem();
    const seen: string[] = [];
    disk
      .when(true, () => seen.push("when-yes"), () => seen.push("when-no"))
      .when(() => false, () => seen.push("when-yes2"), () => seen.push("when-no2"))
      .unless(false, () => seen.push("unless-yes"))
      .unless((d) => d instanceof MemoryFilesystem, () => seen.push("unless-no"), () => seen.push("unless-else"));
    expect(seen).toEqual(["when-yes", "when-no2", "unless-yes", "unless-else"]);
  });
});

describe("MemoryFilesystem", () => {
  test("directory listing is derived from file paths", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("a/b/c.txt", "1");
    await disk.put("a/x.txt", "1");
    await disk.put("root.txt", "1");
    expect(await disk.files()).toEqual(["root.txt"]);
    expect(await disk.files("a")).toEqual(["a/x.txt"]);
    expect(await disk.directories()).toEqual(["a"]);
    expect(await disk.allDirectories()).toEqual(["a", "a/b"]);
    expect(await disk.allFiles("a")).toEqual(["a/b/c.txt", "a/x.txt"]);
  });

  test("a directory prefix does not match siblings that merely share its name", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("notes/a.txt", "1");
    await disk.put("notes-old/b.txt", "1");
    expect(await disk.allFiles("notes")).toEqual(["notes/a.txt"]);
    expect(await disk.files("notes")).toEqual(["notes/a.txt"]);
    await disk.deleteDirectory("notes");
    expect(await disk.exists("notes-old/b.txt")).toBe(true);
  });

  test("directoryExists is true for explicit and implied directories; deleteDirectory removes files too", async () => {
    const disk = new MemoryFilesystem();
    await disk.makeDirectory("/empty/");
    await disk.put("full/f.txt", "1");
    expect(await disk.directoryExists("empty")).toBe(true);
    expect(await disk.directoryExists("full")).toBe(true);
    expect(await disk.directoryExists("none")).toBe(false);
    await disk.deleteDirectory("full");
    expect(await disk.exists("full/f.txt")).toBe(false);
    expect(await disk.directoryExists("full")).toBe(false);
  });

  test("move overwrites the target and drops the source; missing source rejects", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("a.txt", "new");
    await disk.put("b.txt", "old");
    await disk.move("a.txt", "b.txt");
    expect(text(await disk.get("b.txt"))).toBe("new");
    expect(await disk.exists("a.txt")).toBe(false);
    await expect(disk.move("ghost", "x")).rejects.toThrow("does not exist");
    expect(await disk.exists("x")).toBe(false);
  });

  test("size, lastModified (epoch seconds), mimeType and url", async () => {
    const disk = new MemoryFilesystem();
    await disk.put("pic.JPG", new Uint8Array(5));
    expect(await disk.size("pic.JPG")).toBe(5);
    const modified = await disk.lastModified("pic.JPG");
    expect(Number.isInteger(modified)).toBe(true);
    expect(modified).toBeGreaterThan(1_600_000_000);
    expect(await disk.mimeType("pic.JPG")).toBe("image/jpeg");
    expect(await disk.mimeType("x.weird")).toBe("application/octet-stream");
    expect(disk.url("a/b.txt")).toBe("/storage/a/b.txt");
    await expect(disk.lastModified("none")).rejects.toThrow("does not exist");
    await expect(disk.size("none")).rejects.toThrow("does not exist");
  });
});

describe("Storage.fake assertions", () => {
  let restoreTarget: StorageManager;

  beforeEach(() => {
    restoreTarget = new StorageManager({ default: "local", disks: { local: new MemoryFilesystem() } });
    setStorage(restoreTarget);
  });

  afterEach(() => {
    Storage.restore();
  });

  test("assertExists and assertMissing name the offending path", async () => {
    Storage.fake();
    await Storage.put("a.txt", "1");
    expect(() => Storage.assertExists(["a.txt", "b.txt"])).toThrow("Expected file [b.txt] to exist.");
    expect(() => Storage.assertMissing("a.txt")).toThrow("Expected file [a.txt] to be missing.");
  });

  test("assertCount reports expected vs actual and can be scoped to a directory", async () => {
    Storage.fake();
    await Storage.put("img/a.png", "1");
    await Storage.put("img/b.png", "1");
    await Storage.put("doc.txt", "1");
    Storage.assertCount(3);
    Storage.assertCount(2, "img");
    Storage.assertCount(2, "/img/");
    expect(() => Storage.assertCount(5)).toThrow("Expected 5 file(s), got 3.");
    expect(() => Storage.assertCount(1, "img")).toThrow("Expected 1 file(s), got 2.");
    expect(() => Storage.assertEmpty()).toThrow("Expected disk to be empty, got 3 file(s).");
  });

  test("assertDirectoryEmpty ignores files in nested subdirectories and other folders", async () => {
    Storage.fake();
    await Storage.put("a/b/deep.txt", "1");
    await Storage.put("other.txt", "1");
    Storage.assertDirectoryEmpty("a");
    expect(() => Storage.assertDirectoryEmpty("a/b")).toThrow("found [a/b/deep.txt]");
    expect(() => Storage.assertDirectoryEmpty()).toThrow("found [other.txt]");
  });

  test("assertions fail clearly when the disk was never faked", async () => {
    expect(() => Storage.assertExists("x")).toThrow("Call Storage.fake() before asserting");
  });

  test("fake() swaps only the default disk, restore() puts the real one back", async () => {
    const real = restoreTarget.disk("local");
    const fake = Storage.fake();
    expect(fake).toBeInstanceOf(StorageFake);
    expect(Storage.disk()).toBe(fake);
    Storage.restore();
    expect(Storage.disk()).toBe(real);
  });

  test("faking a disk that was not configured forgets it again on restore", async () => {
    const fake = Storage.fake("scratch");
    expect(Storage.disk("scratch")).toBe(fake);
    Storage.restore();
    expect(() => Storage.disk("scratch")).toThrow("not configured");
  });

  test("a fake never touches the real disk's files", async () => {
    const dir = new LocalFilesystem({ root });
    setStorage(new StorageManager({ disks: { local: dir } }));
    Storage.fake();
    await Storage.put("fake-only.txt", "1");
    Storage.restore();
    expect(await dir.exists("fake-only.txt")).toBe(false);
    expect(resolve(dir.path())).toBe(root);
  });
});

describe("StorageManager", () => {
  test("build(): string root, config object, custom driver, and failures", () => {
    const manager = new StorageManager();
    expect(manager.build(root)).toBeInstanceOf(LocalFilesystem);
    expect(manager.build({ driver: "local", root, url: "/files" }).url("a")).toBe("/files/a");
    expect(() => manager.build({ driver: "local" })).toThrow("requires a root path");
    expect(() => manager.build({ root: "" })).toThrow("requires a root path");
    expect(() => manager.build({ driver: "ftp" })).toThrow("Disk driver [ftp] is not supported");

    const custom = new MemoryFilesystem();
    manager.extend("mem", (config) => {
      expect(config).toMatchObject({ driver: "mem", flag: true });
      return custom;
    });
    expect(manager.build({ driver: "mem", flag: true })).toBe(custom);
  });

  test("custom disks are created lazily once and then cached", () => {
    let created = 0;
    const manager = new StorageManager().extend("lazy", () => {
      created++;
      return new MemoryFilesystem();
    });
    expect(created).toBe(0);
    const first = manager.disk("lazy");
    expect(manager.disk("lazy")).toBe(first);
    expect(created).toBe(1);
    manager.purge("lazy");
    expect(manager.disk("lazy")).not.toBe(first);
    expect(created).toBe(2);
  });

  test("default and cloud driver names are switchable, and unknown disks throw", () => {
    const a = new MemoryFilesystem();
    const b = new MemoryFilesystem();
    const manager = new StorageManager({ disks: { a, b } });
    expect(() => manager.disk()).toThrow("Disk [local] is not configured.");
    manager.setDefaultDriver("a").setDefaultCloudDriver("b");
    expect(manager.disk()).toBe(a);
    expect(manager.cloud()).toBe(b);
    expect(manager.getDefaultCloudDriver()).toBe("b");
    manager.forgetDisk(["a", "b"]);
    expect(() => manager.cloud()).toThrow("Disk [b] is not configured.");
  });

  test("the manager proxies calls to the default disk", async () => {
    const mem = new MemoryFilesystem();
    const manager = new StorageManager({ disks: { local: mem } });
    await manager.put("p.txt", "v");
    expect(await manager.exists("p.txt")).toBe(true);
    expect(await manager.size("p.txt")).toBe(1);
    expect(manager.url("p.txt")).toBe("/storage/p.txt");
    expect(await manager.missing("q.txt")).toBe(true);
    expect(await mem.exists("p.txt")).toBe(true);
  });
});
