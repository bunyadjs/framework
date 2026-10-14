import type { Filesystem } from "@bunyad/contracts";
import { createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  realpath,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { Disk } from "./disk.ts";

/** Bun fast paths when available; node:fs fallbacks otherwise (Node). */
const bun = (globalThis as { Bun?: typeof Bun }).Bun;

async function fileExists(full: string): Promise<boolean> {
  if (bun) return bun.file(full).exists();
  try {
    return (await stat(full)).isFile();
  } catch {
    return false;
  }
}

export type LocalFilesystemOptions = {
  root: string;
  /** URL prefix for `url()`, e.g. `/storage` or `https://cdn.example/`. */
  url?: string;
};

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

/**
 * Local disk driver (`local` / `public`).
 */
export class LocalFilesystem extends Disk implements Filesystem {
  readonly #root: string;
  readonly #url: string;

  constructor(options: LocalFilesystemOptions) {
    super();
    this.#root = resolve(options.root);
    this.#url = options.url ?? "";
  }

  /**
   * Resolve `path` under the disk root. Rejects `..` / absolute escapes (BUN-SEC-004).
   */
  #full(path: string): string {
    const root = this.#root;
    const full = resolve(root, path);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(
        `Path traversal detected: [${path}] is outside disk root.`,
      );
    }
    return full;
  }

  /** Real path of the disk root, even before the root directory exists. */
  async #realRoot(): Promise<string> {
    const missing: string[] = [];
    let current = this.#root;
    for (;;) {
      try {
        return join(await realpath(current), ...missing.reverse());
      } catch {
        const parent = dirname(current);
        if (parent === current) return this.#root;
        missing.push(current.slice(parent.length + 1));
        current = parent;
      }
    }
  }

  /**
   * Like `#full`, but also follows symlinks: the deepest existing part of the path must
   * resolve inside the (real) disk root, and a dangling link is never written through.
   */
  async #resolve(path: string): Promise<string> {
    const full = this.#full(path);
    const realRoot = await this.#realRoot();
    const missing: string[] = [];
    let current = full;
    for (;;) {
      try {
        const real = join(await realpath(current), ...missing.reverse());
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
          throw new Error(
            `Path traversal detected: [${path}] resolves outside disk root.`,
          );
        }
        return full;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === undefined) throw error;
        // A link that exists but cannot be resolved is dangling: never write through it.
        if (
          await lstat(current).then(
            () => true,
            () => false,
          )
        ) {
          throw new Error(
            `Path traversal detected: [${path}] is a dangling symlink.`,
          );
        }
        const parent = dirname(current);
        if (parent === current) return full;
        missing.push(current.slice(parent.length + 1));
        current = parent;
      }
    }
  }

  #normalizeDir(directory = ""): string {
    return directory.replace(/^\/+|\/+$/g, "");
  }

  path(path = ""): string {
    return path ? this.#full(path) : this.#root;
  }

  async put(path: string, contents: string | Uint8Array): Promise<void> {
    const full = await this.#resolve(path);
    await mkdir(dirname(full), { recursive: true });
    if (bun) await bun.write(full, contents);
    else await writeFile(full, contents);
  }

  /**
   * Stream chunks straight to disk (no full-body buffering). Writes to a
   * sibling temp file and renames into place, so readers never observe a
   * partially written file; on failure the temp file is removed and any
   * previous file at `path` is left intact.
   */
  override async writeStream(
    path: string,
    stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const full = await this.#resolve(path);
    await mkdir(dirname(full), { recursive: true });
    const temp = `${full}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.tmp`;
    const out = createWriteStream(temp);
    const opened = new Promise<void>((resolveOpen, rejectOpen) => {
      out.once("open", () => resolveOpen());
      out.once("error", rejectOpen);
    });
    let failure: unknown = null;
    out.on("error", (error) => {
      failure ??= error;
    });
    const write = (chunk: Uint8Array): Promise<void> | undefined => {
      if (failure) throw failure;
      if (out.write(chunk)) return undefined;
      return new Promise<void>((resolveDrain, rejectDrain) => {
        const onDrain = () => {
          out.off("error", onError);
          resolveDrain();
        };
        const onError = (error: unknown) => {
          out.off("drain", onDrain);
          rejectDrain(error);
        };
        out.once("drain", onDrain);
        out.once("error", onError);
      });
    };
    try {
      await opened;
      if (Symbol.asyncIterator in stream) {
        for await (const chunk of stream) await write(chunk);
      } else {
        const reader = (stream as ReadableStream<Uint8Array>).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) await write(value);
        }
      }
      await new Promise<void>((resolveEnd, rejectEnd) => {
        if (failure) {
          rejectEnd(failure);
          return;
        }
        out.end((error?: Error | null) =>
          error ? rejectEnd(error) : resolveEnd(),
        );
      });
      await rename(temp, full);
    } catch (error) {
      out.destroy();
      await rm(temp, { force: true });
      throw error;
    }
  }

  async get(path: string): Promise<Uint8Array> {
    const full = await this.#resolve(path);
    if (!(await fileExists(full))) {
      throw new Error(`File not found: [${path}]`);
    }
    if (bun) return new Uint8Array(await bun.file(full).arrayBuffer());
    const buf = await readFile(full);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async exists(path: string): Promise<boolean> {
    return fileExists(await this.#resolve(path));
  }

  async delete(path: string): Promise<boolean> {
    const full = await this.#resolve(path);
    if (!(await fileExists(full))) return false;
    await unlink(full);
    return true;
  }

  async copy(from: string, to: string): Promise<void> {
    const contents = await this.get(from);
    await this.put(to, contents);
  }

  async move(from: string, to: string): Promise<void> {
    const source = await this.#resolve(from);
    const target = await this.#resolve(to);
    await mkdir(dirname(target), { recursive: true });
    try {
      await rename(source, target);
    } catch {
      await this.copy(from, to);
      await this.delete(from);
    }
  }

  async files(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const full = dir ? await this.#resolve(dir) : this.#root;
    try {
      const entries = await readdir(full, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => (dir ? `${dir}/${entry.name}` : entry.name))
        .sort();
    } catch {
      return [];
    }
  }

  async allFiles(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const full = dir ? await this.#resolve(dir) : this.#root;
    const out: string[] = [];

    async function walk(current: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const rel = relative(full, abs).split(sep).join("/");
        out.push(dir ? `${dir}/${rel}` : rel);
      }
    }

    await walk(full);
    return out.sort();
  }

  async directories(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const full = dir ? await this.#resolve(dir) : this.#root;
    try {
      const entries = await readdir(full, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => (dir ? `${dir}/${entry.name}` : entry.name))
        .sort();
    } catch {
      return [];
    }
  }

  async allDirectories(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const full = dir ? await this.#resolve(dir) : this.#root;
    const out: string[] = [];

    async function walk(current: string): Promise<void> {
      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const abs = join(current, entry.name);
        const rel = relative(full, abs).split(sep).join("/");
        out.push(dir ? `${dir}/${rel}` : rel);
        await walk(abs);
      }
    }

    await walk(full);
    return out.sort();
  }

  async makeDirectory(path: string): Promise<boolean> {
    await mkdir(await this.#resolve(path), { recursive: true });
    return true;
  }

  async deleteDirectory(directory: string): Promise<boolean> {
    const full = await this.#resolve(directory);
    try {
      await rm(full, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async directoryExists(path: string): Promise<boolean> {
    try {
      const info = await stat(await this.#resolve(path));
      return info.isDirectory();
    } catch {
      return false;
    }
  }

  async size(path: string): Promise<number> {
    const full = await this.#resolve(path);
    if (bun) return bun.file(full).size;
    return (await stat(full)).size;
  }

  async lastModified(path: string): Promise<number> {
    const info = await stat(await this.#resolve(path));
    return Math.floor(info.mtimeMs / 1000);
  }

  async mimeType(path: string): Promise<string> {
    const type = bun ? bun.file(await this.#resolve(path)).type : "";
    if (type && type !== "application/octet-stream") return type;
    return (
      MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream"
    );
  }

  url(path: string): string {
    const base = this.#url.replace(/\/$/, "");
    const rel = path.replace(/^\//, "");
    return base ? `${base}/${rel}` : `/${rel}`;
  }
}
