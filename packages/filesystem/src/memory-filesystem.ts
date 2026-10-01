import type { Filesystem } from "@bunyad/contracts";
import { extname } from "node:path";
import { Disk } from "./disk.ts";

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/**
 * In-memory filesystem — used by `Storage.fake()`.
 */
export class MemoryFilesystem extends Disk implements Filesystem {
  /** In-memory file contents (testing / fake disk). */
  readonly entries = new Map<string, Uint8Array>();
  readonly #directories = new Set<string>();
  readonly #modified = new Map<string, number>();

  #normalizeDir(directory = ""): string {
    return directory.replace(/^\/+|\/+$/g, "");
  }

  #touch(path: string): void {
    this.#modified.set(path, Math.floor(Date.now() / 1000));
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.#directories.add(parts.slice(0, i).join("/"));
    }
  }

  path(path = ""): string {
    return path;
  }

  async put(path: string, contents: string | Uint8Array): Promise<void> {
    const data =
      typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
    this.entries.set(path, data);
    this.#touch(path);
  }

  async get(path: string): Promise<Uint8Array> {
    const data = this.entries.get(path);
    if (!data) throw new Error(`File [${path}] does not exist.`);
    return data;
  }

  async exists(path: string): Promise<boolean> {
    return this.entries.has(path);
  }

  async delete(path: string): Promise<boolean> {
    this.#modified.delete(path);
    return this.entries.delete(path);
  }

  async copy(from: string, to: string): Promise<void> {
    const data = await this.get(from);
    await this.put(to, data);
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.delete(from);
  }

  async files(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const prefix = dir ? `${dir}/` : "";
    const out: string[] = [];
    for (const path of this.entries.keys()) {
      if (dir && !path.startsWith(prefix)) continue;
      if (!dir && path.includes("/")) continue;
      const rest = dir ? path.slice(prefix.length) : path;
      if (!rest || rest.includes("/")) continue;
      out.push(path);
    }
    return out.sort();
  }

  async allFiles(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const prefix = dir ? `${dir}/` : "";
    const out: string[] = [];
    for (const path of this.entries.keys()) {
      if (dir && path !== dir && !path.startsWith(prefix)) continue;
      if (dir && path === dir) continue;
      out.push(path);
    }
    return out.sort();
  }

  async directories(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const prefix = dir ? `${dir}/` : "";
    const out: string[] = [];
    for (const path of this.#directories) {
      if (dir) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
      } else if (path.includes("/")) {
        continue;
      }
      out.push(path);
    }
    return out.sort();
  }

  async allDirectories(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const prefix = dir ? `${dir}/` : "";
    const out: string[] = [];
    for (const path of this.#directories) {
      if (dir && !path.startsWith(prefix)) continue;
      out.push(path);
    }
    return out.sort();
  }

  async makeDirectory(path: string): Promise<boolean> {
    const dir = this.#normalizeDir(path);
    if (!dir) return true;
    const parts = dir.split("/");
    for (let i = 1; i <= parts.length; i++) {
      this.#directories.add(parts.slice(0, i).join("/"));
    }
    return true;
  }

  async deleteDirectory(directory: string): Promise<boolean> {
    const dir = this.#normalizeDir(directory);
    const prefix = dir ? `${dir}/` : "";
    for (const path of [...this.entries.keys()]) {
      if (path === dir || path.startsWith(prefix)) {
        this.entries.delete(path);
        this.#modified.delete(path);
      }
    }
    for (const path of [...this.#directories]) {
      if (path === dir || path.startsWith(prefix)) {
        this.#directories.delete(path);
      }
    }
    return true;
  }

  async directoryExists(path: string): Promise<boolean> {
    const dir = this.#normalizeDir(path);
    if (this.#directories.has(dir)) return true;
    const prefix = `${dir}/`;
    for (const file of this.entries.keys()) {
      if (file.startsWith(prefix)) return true;
    }
    return false;
  }

  async size(path: string): Promise<number> {
    return (await this.get(path)).byteLength;
  }

  async lastModified(path: string): Promise<number> {
    if (!(await this.exists(path))) {
      throw new Error(`File [${path}] does not exist.`);
    }
    return this.#modified.get(path) ?? Math.floor(Date.now() / 1000);
  }

  async mimeType(path: string): Promise<string> {
    return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
  }

  url(path: string): string {
    return `/storage/${path}`;
  }
}
