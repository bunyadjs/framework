/**
 * `@bunyad/sitemap/disk` — publish through a `@bunyad/filesystem` disk (T2.3).
 * Streams via `Disk.writeStream` (true streaming on the local disk since T0.1;
 * S3 still buffers each file, ≤ 50 MB per part).
 */
import type { Filesystem } from "@bunyad/contracts";
import { Storage } from "@bunyad/filesystem";
import {
  assertSafeName,
  type SinkWritable,
  type SitemapSink,
} from "./sinks.ts";
import type { Sitemap, WriteOptions } from "./sitemap.ts";
import type { WriteResult } from "./writer.ts";

/** Reject traversal, absolute paths, NUL and encoded dots/slashes. Returns a clean relative path. */
export function safeDiskPath(path: string): string {
  if (path.includes("\0")) throw new Error("Sitemap path contains a NUL byte.");
  if (/%2e|%2f|%5c/i.test(path))
    throw new Error(`Encoded path segments are not allowed [${path}].`);
  if (path.includes("\\"))
    throw new Error(`Backslashes are not allowed [${path}].`);
  const clean = path.replace(/^\/+/, "").replace(/\/+$/, "");
  if (/^[A-Za-z]:/.test(clean))
    throw new Error(`Absolute paths are not allowed [${path}].`);
  const segments = clean.split("/");
  if (segments.some((s) => s === ".." || s === "." || s === "")) {
    if (clean !== "") throw new Error(`Path traversal detected [${path}].`);
  }
  return clean;
}

/** Split `dir/name.xml` into a safe directory + file name. */
export function splitDiskPath(path: string): {
  directory: string;
  filename: string;
} {
  const clean = safeDiskPath(path);
  const slash = clean.lastIndexOf("/");
  const filename = assertSafeName(
    slash === -1 ? clean : clean.slice(slash + 1),
  );
  return { directory: slash === -1 ? "" : clean.slice(0, slash), filename };
}

/** A pushable async iterable: each `push` resolves once the consumer pulled it. */
function channel() {
  const queue: { chunk: Uint8Array; done: () => void }[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  let failure: unknown = null;
  const notify = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  return {
    push(chunk: Uint8Array): Promise<void> {
      return new Promise<void>((done) => {
        queue.push({ chunk, done });
        notify();
      });
    },
    end() {
      ended = true;
      notify();
    },
    fail(error: unknown) {
      failure = error;
      notify();
    },
    async *iterate(): AsyncGenerator<Uint8Array> {
      for (;;) {
        if (failure) throw failure;
        const next = queue.shift();
        if (next) {
          next.done();
          yield next.chunk;
          continue;
        }
        if (ended) return;
        await new Promise<void>((r) => {
          wake = r;
        });
      }
    },
  };
}

/** Sink over a disk directory. */
export function diskSink(disk: Filesystem, directory = ""): SitemapSink {
  const dir = safeDiskPath(directory);
  const full = (name: string) =>
    dir ? `${dir}/${assertSafeName(name)}` : assertSafeName(name);
  return {
    async open(name) {
      const path = full(name);
      const ch = channel();
      const writing = disk.writeStream(path, ch.iterate());
      let failed: unknown = null;
      writing.catch((error: unknown) => {
        failed = error;
      });
      const out: SinkWritable = {
        async write(chunk) {
          if (failed) throw failed;
          await Promise.race([
            ch.push(chunk.slice()),
            writing.then(() => undefined),
          ]);
          if (failed) throw failed;
        },
        async close() {
          ch.end();
          await writing;
        },
        async abort() {
          ch.fail(new Error("aborted"));
          await writing.catch(() => {});
          await disk.delete(path).catch(() => false);
        },
      };
      return out;
    },
    async *read(name) {
      const reader = (await disk.readStream(full(name))).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    },
    async move(from, to) {
      await disk.move(full(from), full(to));
    },
    async delete(name) {
      await disk.delete(full(name));
    },
    async list() {
      const files = await disk.files(dir);
      return files.map((f) => f.slice(f.lastIndexOf("/") + 1));
    },
  };
}

/** spatie `writeToDisk($disk, $path)`: defaults to the `public` disk and `sitemap.xml` (D2). */
export function writeToDisk(
  sitemap: Sitemap,
  disk: string | Filesystem = "public",
  path = "sitemap.xml",
  options: WriteOptions = {},
): Promise<WriteResult> {
  const fs = typeof disk === "string" ? Storage.disk(disk) : disk;
  const { directory, filename } = splitDiskPath(path);
  return sitemap.writeTo(diskSink(fs, directory), filename, options);
}
