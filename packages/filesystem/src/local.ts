import type { Filesystem } from "@bunyad/contracts";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { Disk } from "./disk.ts";

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
      throw new Error(`Path traversal detected: [${path}] is outside disk root.`);
    }
    return full;
  }

  #normalizeDir(directory = ""): string {
    return directory.replace(/^\/+|\/+$/g, "");
  }

  path(path = ""): string {
    return path ? this.#full(path) : this.#root;
  }

  async put(path: string, contents: string | Uint8Array): Promise<void> {
    const full = this.#full(path);
    await mkdir(dirname(full), { recursive: true });
    await Bun.write(full, contents);
  }

  async get(path: string): Promise<Uint8Array> {
    const file = Bun.file(this.#full(path));
    if (!(await file.exists())) {
      throw new Error(`File not found: [${path}]`);
    }
    return new Uint8Array(await file.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    return Bun.file(this.#full(path)).exists();
  }

  async delete(path: string): Promise<boolean> {
    const full = this.#full(path);
    if (!(await Bun.file(full).exists())) return false;
    await unlink(full);
    return true;
  }

  async copy(from: string, to: string): Promise<void> {
    const contents = await this.get(from);
    await this.put(to, contents);
  }

  async move(from: string, to: string): Promise<void> {
    const source = this.#full(from);
    const target = this.#full(to);
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
    const full = dir ? this.#full(dir) : this.#root;
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
    const full = dir ? this.#full(dir) : this.#root;
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
    const full = dir ? this.#full(dir) : this.#root;
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
    const full = dir ? this.#full(dir) : this.#root;
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
    await mkdir(this.#full(path), { recursive: true });
    return true;
  }

  async deleteDirectory(directory: string): Promise<boolean> {
    const full = this.#full(directory);
    try {
      await rm(full, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async directoryExists(path: string): Promise<boolean> {
    try {
      const info = await stat(this.#full(path));
      return info.isDirectory();
    } catch {
      return false;
    }
  }

  async size(path: string): Promise<number> {
    return Bun.file(this.#full(path)).size;
  }

  async lastModified(path: string): Promise<number> {
    const info = await stat(this.#full(path));
    return Math.floor(info.mtimeMs / 1000);
  }

  async mimeType(path: string): Promise<string> {
    const type = Bun.file(this.#full(path)).type;
    if (type && type !== "application/octet-stream") return type;
    return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
  }

  url(path: string): string {
    const base = this.#url.replace(/\/$/, "");
    const rel = path.replace(/^\//, "");
    return base ? `${base}/${rel}` : `/${rel}`;
  }
}
