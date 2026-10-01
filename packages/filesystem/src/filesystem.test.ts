import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LocalFilesystem,
  MemoryFilesystem,
  StorageManager,
  setStorage,
  Storage,
  StorageFake,
} from "../src/index.ts";

test("local disk put get exists delete url", async () => {
  const root = resolve(import.meta.dir, "../.tmp-fs");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const disk = new LocalFilesystem({ root, url: "/storage" });
  await disk.put("notes/a.txt", "hello");
  expect(await disk.exists("notes/a.txt")).toBe(true);
  expect(new TextDecoder().decode(await disk.get("notes/a.txt"))).toBe("hello");
  expect(disk.url("notes/a.txt")).toBe("/storage/notes/a.txt");
  expect(await disk.delete("notes/a.txt")).toBe(true);
  expect(await disk.exists("notes/a.txt")).toBe(false);

  await rm(root, { recursive: true, force: true });
});

test("Storage helper uses default disk", async () => {
  const root = resolve(import.meta.dir, "../.tmp-fs2");
  await rm(root, { recursive: true, force: true });
  setStorage(
    new StorageManager({
      disks: { local: new LocalFilesystem({ root }) },
    }),
  );
  await Storage.disk().put("x.txt", "y");
  expect(await Storage.disk().exists("x.txt")).toBe(true);
  await rm(root, { recursive: true, force: true });
});

test("Storage.fake records files in memory", async () => {
  const root = resolve(import.meta.dir, "../.tmp-fs3");
  await rm(root, { recursive: true, force: true });
  setStorage(
    new StorageManager({
      disks: { local: new LocalFilesystem({ root }) },
    }),
  );

  const fake = Storage.fake();
  await Storage.put("avatar.png", "bytes");
  Storage.assertExists("avatar.png");
  Storage.assertCount(1);

  await Storage.delete("avatar.png");
  Storage.assertMissing("avatar.png");
  Storage.assertEmpty();

  Storage.restore();
  expect(fake.entries.size).toBe(0);
});

test("S3Filesystem delegates to client", async () => {
  const store = new Map<string, Uint8Array | string>();
  const client = {
    async write(key: string, data: string | Uint8Array) {
      store.set(key, data);
    },
    file(key: string) {
      return {
        async arrayBuffer() {
          const v = store.get(key);
          if (v == null) throw new Error("missing");
          if (typeof v === "string") return new TextEncoder().encode(v).buffer;
          return v.buffer;
        },
        presign(options?: { method?: string }) {
          return `https://s3.test/${options?.method ?? "GET"}/${key}`;
        },
      };
    },
    async exists(key: string) {
      return store.has(key);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options: { prefix?: string } = {}) {
      const prefix = options.prefix ?? "";
      return [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => ({ key }));
    },
  };

  const { S3Filesystem } = await import("../src/s3.ts");
  const disk = new S3Filesystem({
    accessKeyId: "x",
    secretAccessKey: "y",
    bucket: "b",
    client: client as never,
    url: "https://cdn.test",
  });
  await disk.put("a.txt", "hi");
  expect(await disk.exists("a.txt")).toBe(true);
  expect(await disk.missing("nope.txt")).toBe(true);
  expect(new TextDecoder().decode(await disk.get("a.txt"))).toBe("hi");
  expect(disk.url("a.txt")).toBe("https://cdn.test/a.txt");
  await disk.copy("a.txt", "b.txt");
  expect(await disk.exists("b.txt")).toBe(true);
  await disk.move("b.txt", "dir/c.txt");
  expect(await disk.files("dir")).toEqual(["dir/c.txt"]);
  expect(await disk.delete("a.txt")).toBe(true);
  expect(disk.providesTemporaryUrls()).toBe(true);
  expect(await disk.temporaryUrl("dir/c.txt")).toContain("https://s3.test/");
  const upload = await disk.temporaryUploadUrl("dir/c.txt");
  expect(upload.url).toContain("PUT");
});

test("Storage missing copy move files allFiles", async () => {
  const root = resolve(import.meta.dir, "../.tmp-fs4");
  await rm(root, { recursive: true, force: true });
  setStorage(
    new StorageManager({
      disks: { local: new LocalFilesystem({ root }) },
    }),
  );

  await Storage.put("notes/a.txt", "a");
  await Storage.put("notes/deep/b.txt", "b");
  await Storage.put("root.txt", "r");

  expect(await Storage.missing("nope.txt")).toBe(true);
  expect(await Storage.files("notes")).toEqual(["notes/a.txt"]);
  expect(await Storage.allFiles("notes")).toEqual([
    "notes/a.txt",
    "notes/deep/b.txt",
  ]);

  await Storage.copy("root.txt", "root-copy.txt");
  expect(await Storage.exists("root-copy.txt")).toBe(true);
  await Storage.move("root-copy.txt", "moved.txt");
  expect(await Storage.exists("moved.txt")).toBe(true);
  expect(await Storage.missing("root-copy.txt")).toBe(true);

  await rm(root, { recursive: true, force: true });
});

test("append prepend directories putFile size mimeType streams", async () => {
  const root = resolve(import.meta.dir, "../.tmp-fs5");
  await rm(root, { recursive: true, force: true });
  const disk = new LocalFilesystem({ root, url: "/storage" });

  await disk.put("log.txt", "mid");
  await disk.prepend("log.txt", "start-");
  await disk.append("log.txt", "-end");
  expect(new TextDecoder().decode(await disk.get("log.txt"))).toBe(
    "start-mid-end",
  );

  await disk.put("a/b/c.txt", "nested");
  expect(await disk.directories()).toEqual(["a"]);
  expect(await disk.allDirectories()).toEqual(["a", "a/b"]);
  expect(await disk.directoryExists("a/b")).toBe(true);
  expect(await disk.directoryMissing("missing")).toBe(true);

  const stored = await disk.putFileAs("uploads", "photo-bytes", "pic.png");
  expect(stored).toBe("uploads/pic.png");
  expect(await disk.size("uploads/pic.png")).toBe(11);
  expect(await disk.mimeType("uploads/pic.png")).toBe("image/png");
  expect(disk.path("uploads/pic.png")).toBe(resolve(root, "uploads/pic.png"));

  await disk.writeStream(
    "stream.txt",
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("streamed"));
        controller.close();
      },
    }),
  );
  const reader = (await disk.readStream("stream.txt")).getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toBe("streamed");

  await disk.put("data.json", JSON.stringify({ ok: true }));
  expect(await disk.json("data.json")).toEqual({ ok: true });
  expect(await disk.checksum("data.json")).toHaveLength(32);

  const res = await disk.download("uploads/pic.png", "down.png");
  expect(res.headers.get("Content-Disposition")).toContain("attachment");
  expect(await res.text()).toBe("photo-bytes");

  disk.when(true, (d) => d);
  disk.unless(false, (d) => d);

  await disk.makeDirectory("empty-dir");
  expect(await disk.directoryExists("empty-dir")).toBe(true);
  await disk.deleteDirectory("a");
  expect(await disk.directoryMissing("a")).toBe(true);

  await rm(root, { recursive: true, force: true });
});

test("Storage manager drive extend forgetDisk purge cloud set", async () => {
  const local = new MemoryFilesystem();
  const cloud = new MemoryFilesystem();
  const manager = new StorageManager({
    default: "local",
    cloud: "s3",
    disks: { local, s3: cloud },
  });
  setStorage(manager);

  expect(Storage.getDefaultDriver()).toBe("local");
  expect(Storage.drive()).toBe(local);
  expect(Storage.cloud()).toBe(cloud);

  const custom = new MemoryFilesystem();
  Storage.extend("custom", () => custom);
  expect(Storage.disk("custom")).toBe(custom);

  Storage.set("extra", new MemoryFilesystem());
  await Storage.disk("extra").put("x.txt", "1");
  expect(await Storage.disk("extra").exists("x.txt")).toBe(true);

  Storage.forgetDisk("extra");
  expect(() => Storage.disk("extra")).toThrow(/not configured/);

  Storage.purge("custom");
  // re-create via extend
  expect(Storage.disk("custom")).toBe(custom);

  Storage.purge();
  expect(() => Storage.disk("local")).toThrow(/not configured/);
});

test("Storage.build creates on-demand local disk", async () => {
  const root = resolve(import.meta.dir, "../.tmp-fs-build");
  await rm(root, { recursive: true, force: true });
  setStorage(new StorageManager({ disks: {} }));

  const disk = Storage.build(root);
  await disk.put("built.txt", "yes");
  expect(await disk.exists("built.txt")).toBe(true);
  expect(disk.path("built.txt")).toBe(resolve(root, "built.txt"));

  await rm(root, { recursive: true, force: true });
});

test("StorageFake assertDirectoryEmpty", async () => {
  setStorage(
    new StorageManager({
      disks: { local: new MemoryFilesystem() },
    }),
  );
  Storage.fake();
  await Storage.put("dir/a.txt", "a");
  expect(() => Storage.assertDirectoryEmpty("dir")).toThrow(/empty/);
  await Storage.delete("dir/a.txt");
  Storage.assertDirectoryEmpty("dir");
  Storage.assertEmpty();
});

test("local disk rejects path traversal outside root", async () => {
  const root = resolve(import.meta.dir, "../.tmp-fs-sec");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const disk = new LocalFilesystem({ root });
  await expect(disk.put("../../../tmp/pwn", "x")).rejects.toThrow(
    /Path traversal/,
  );
  await expect(disk.put("/etc/passwd", "x")).rejects.toThrow(/Path traversal/);
  await expect(disk.get("foo/../../etc/passwd")).rejects.toThrow(
    /Path traversal/,
  );
  await expect(
    disk.putFileAs("uploads", "bytes", "../../../escape.png"),
  ).rejects.toThrow(/Path traversal/);
  await disk.put("safe/file.txt", "ok");
  const full = disk.path("safe/file.txt");
  expect(full.startsWith(root)).toBe(true);
  expect(full.includes("..")).toBe(false);

  await rm(root, { recursive: true, force: true });
});

test("Storage.fake named disk restore and assert arrays", async () => {
  const local = new MemoryFilesystem();
  const s3 = new MemoryFilesystem();
  setStorage(
    new StorageManager({
      default: "local",
      cloud: "s3",
      disks: { local, s3 },
    }),
  );

  await Storage.disk("local").put("keep.txt", "local");
  const fake = Storage.fake("s3");
  await Storage.disk("s3").put("cloud.png", "bytes");
  Storage.assertExists("cloud.png");
  Storage.assertExists(["cloud.png"]);
  Storage.assertMissing(["nope.png", "missing.txt"]);
  Storage.assertCount(1);
  Storage.assertCount(1, "");

  // default local disk untouched
  expect(await Storage.disk("local").exists("keep.txt")).toBe(true);
  expect(Storage.cloud()).toBe(fake);

  Storage.restore();
  expect(Storage.disk("s3")).toBe(s3);
  expect(await Storage.disk("local").exists("keep.txt")).toBe(true);
});

