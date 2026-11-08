import { S3Client } from "bun";
import type { Filesystem } from "@bunyad/contracts";
import { extname } from "node:path";
import { Disk } from "./disk.ts";

export type S3FilesystemOptions = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  region?: string;
  /** Public URL prefix; otherwise `url()` returns a presigned GET URL. */
  url?: string;
  /** Injected client (tests). */
  client?: S3Client;
};

type S3ListResult = {
  contents?: Array<{ key?: string }>;
  Contents?: Array<{ Key?: string; key?: string }>;
};

type S3FileHandle = {
  arrayBuffer(): Promise<ArrayBuffer>;
  size?: number;
  type?: string;
  lastModified?: number;
  presign(options?: {
    expiresIn?: number;
    method?: string;
  }): string;
};

type S3Like = {
  write(path: string, contents: string | Uint8Array): Promise<unknown>;
  file(path: string): S3FileHandle;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<unknown>;
  list?(
    options?: string | { prefix?: string },
  ): Promise<S3ListResult | Array<{ key?: string; Key?: string }>>;
};

const MIME_BY_EXT: Record<string, string> = {
  ".txt": "text/plain",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
};

/**
 * S3-compatible disk (AWS S3, Cloudflare R2, MinIO) via Bun's `S3Client`.
 */
export class S3Filesystem extends Disk implements Filesystem {
  readonly #client: S3Like;
  readonly #url?: string;
  readonly #directories = new Set<string>();

  constructor(options: S3FilesystemOptions) {
    super();
    this.#url = options.url;
    this.#client =
      (options.client as S3Like | undefined) ??
      (new S3Client({
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        bucket: options.bucket,
        endpoint: options.endpoint,
        region: options.region,
      }) as S3Like);
  }

  #normalizeDir(directory = ""): string {
    return directory.replace(/^\/+|\/+$/g, "");
  }

  #rememberDirs(path: string): void {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      this.#directories.add(parts.slice(0, i).join("/"));
    }
  }

  path(path = ""): string {
    return path;
  }

  async put(path: string, contents: string | Uint8Array): Promise<void> {
    await this.#client.write(path, contents);
    this.#rememberDirs(path);
  }

  async get(path: string): Promise<Uint8Array> {
    const file = this.#client.file(path);
    return new Uint8Array(await file.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    return this.#client.exists(path);
  }

  async delete(path: string): Promise<boolean> {
    if (!(await this.exists(path))) return false;
    await this.#client.delete(path);
    return true;
  }

  async copy(from: string, to: string): Promise<void> {
    const contents = await this.get(from);
    await this.put(to, contents);
  }

  async move(from: string, to: string): Promise<void> {
    await this.copy(from, to);
    await this.delete(from);
  }

  async #listKeys(prefix: string): Promise<string[]> {
    if (!this.#client.list) {
      throw new Error("S3 client does not support list().");
    }
    const result = await this.#client.list(
      prefix ? { prefix: prefix.endsWith("/") ? prefix : `${prefix}/` } : {},
    );
    const rows = Array.isArray(result)
      ? result
      : (result.contents ?? result.Contents ?? []);
    const keys: string[] = [];
    for (const row of rows) {
      const key = (row as { key?: string; Key?: string }).key ??
        (row as { Key?: string }).Key;
      if (key) keys.push(key);
    }
    return keys;
  }

  async files(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const keys = await this.#listKeys(dir);
    const prefix = dir ? `${dir}/` : "";
    return keys
      .filter((key) => {
        if (dir && !key.startsWith(prefix)) return false;
        const rest = dir ? key.slice(prefix.length) : key;
        return Boolean(rest) && !rest.includes("/");
      })
      .sort();
  }

  async allFiles(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const keys = await this.#listKeys(dir);
    const prefix = dir ? `${dir}/` : "";
    return keys
      .filter((key) => {
        if (!dir) return true;
        return key.startsWith(prefix);
      })
      .sort();
  }

  async directories(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const prefix = dir ? `${dir}/` : "";
    const keys = await this.#listKeys(dir);
    const found = new Set<string>();
    for (const key of keys) {
      const rest = dir ? key.slice(prefix.length) : key;
      const slash = rest.indexOf("/");
      if (slash > 0) found.add(dir ? `${dir}/${rest.slice(0, slash)}` : rest.slice(0, slash));
    }
    for (const path of this.#directories) {
      if (dir) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
      } else if (path.includes("/")) {
        continue;
      }
      found.add(path);
    }
    return [...found].sort();
  }

  async allDirectories(directory = ""): Promise<string[]> {
    const dir = this.#normalizeDir(directory);
    const prefix = dir ? `${dir}/` : "";
    const keys = await this.#listKeys(dir);
    const found = new Set<string>(this.#directories);
    for (const key of keys) {
      const parts = key.split("/");
      for (let i = 1; i < parts.length; i++) {
        found.add(parts.slice(0, i).join("/"));
      }
    }
    return [...found]
      .filter((path) => {
        if (!dir) return true;
        return path.startsWith(prefix);
      })
      .sort();
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
    const keys = await this.#listKeys(dir);
    for (const key of keys) {
      if (key === dir || key.startsWith(prefix)) {
        await this.#client.delete(key);
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
    const keys = await this.#listKeys(dir);
    const prefix = `${dir}/`;
    return keys.some((key) => key.startsWith(prefix));
  }

  async size(path: string): Promise<number> {
    const file = this.#client.file(path);
    if (typeof file.size === "number") return file.size;
    return (await this.get(path)).byteLength;
  }

  async lastModified(path: string): Promise<number> {
    const file = this.#client.file(path);
    if (typeof file.lastModified === "number") {
      return Math.floor(file.lastModified / 1000);
    }
    await this.get(path);
    return Math.floor(Date.now() / 1000);
  }

  async mimeType(path: string): Promise<string> {
    const type = this.#client.file(path).type;
    if (type && type !== "application/octet-stream") return type;
    return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
  }

  url(path: string): string {
    if (this.#url) {
      const base = this.#url.replace(/\/$/, "");
      return `${base}/${path.replace(/^\//, "")}`;
    }
    return this.#client.file(path).presign({ expiresIn: 3600 });
  }

  providesTemporaryUrls(): boolean {
    return true;
  }

  providesTemporaryUploadUrls(): boolean {
    return true;
  }

  async temporaryUrl(path: string, expiration = new Date(Date.now() + 3600_000)): Promise<string> {
    const expiresIn = Math.max(
      1,
      Math.floor((expiration.getTime() - Date.now()) / 1000),
    );
    return this.#client.file(path).presign({ expiresIn, method: "GET" });
  }

  async temporaryUploadUrl(
    path: string,
    expiration = new Date(Date.now() + 3600_000),
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const expiresIn = Math.max(
      1,
      Math.floor((expiration.getTime() - Date.now()) / 1000),
    );
    return {
      url: this.#client.file(path).presign({ expiresIn, method: "PUT" }),
      headers: {},
    };
  }
}
