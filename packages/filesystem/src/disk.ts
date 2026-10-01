import { createHash } from "node:crypto";
import type {
  Filesystem,
  FilesystemFileSource,
  FilesystemPutFileOptions,
  FilesystemVisibility,
  HeadersInitLike,
} from "@bunyad/contracts";

function encode(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : data;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

async function resolveContents(file: FilesystemFileSource): Promise<Uint8Array> {
  if (typeof file === "string") return encode(file);
  if (file instanceof Uint8Array) return file;
  if (typeof Blob !== "undefined" && file instanceof Blob) {
    return new Uint8Array(await file.arrayBuffer());
  }
  if (typeof file === "object" && file && "arrayBuffer" in file) {
    return new Uint8Array(await file.arrayBuffer());
  }
  throw new Error("Unsupported file source.");
}

function resolveFileName(file: FilesystemFileSource): string {
  if (
    typeof file === "object" &&
    file &&
    !(file instanceof Uint8Array) &&
    !(typeof Blob !== "undefined" && file instanceof Blob) &&
    typeof (file as { hashName?: (path?: string) => string }).hashName ===
      "function"
  ) {
    return (file as { hashName: (path?: string) => string }).hashName();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function visibilityFromOptions(
  options?: FilesystemPutFileOptions,
): FilesystemVisibility | undefined {
  if (options == null) return undefined;
  if (typeof options === "string") return options;
  return options.visibility;
}

/**
 * Shared disk helpers (`append`, `putFile`, streams, etc.).
 */
export abstract class Disk implements Filesystem {
  readonly #visibility = new Map<string, FilesystemVisibility>();

  abstract put(path: string, contents: string | Uint8Array): Promise<void>;
  abstract get(path: string): Promise<Uint8Array>;
  abstract exists(path: string): Promise<boolean>;
  abstract delete(path: string): Promise<boolean>;
  abstract copy(from: string, to: string): Promise<void>;
  abstract move(from: string, to: string): Promise<void>;
  abstract files(directory?: string): Promise<string[]>;
  abstract allFiles(directory?: string): Promise<string[]>;
  abstract url(path: string): string;
  abstract directories(directory?: string): Promise<string[]>;
  abstract allDirectories(directory?: string): Promise<string[]>;
  abstract makeDirectory(path: string): Promise<boolean>;
  abstract deleteDirectory(directory: string): Promise<boolean>;
  abstract directoryExists(path: string): Promise<boolean>;
  abstract size(path: string): Promise<number>;
  abstract lastModified(path: string): Promise<number>;
  abstract mimeType(path: string): Promise<string>;
  abstract path(path?: string): string;

  async missing(path: string): Promise<boolean> {
    return !(await this.exists(path));
  }

  async fileExists(path: string): Promise<boolean> {
    return this.exists(path);
  }

  async fileMissing(path: string): Promise<boolean> {
    return this.missing(path);
  }

  async directoryMissing(path: string): Promise<boolean> {
    return !(await this.directoryExists(path));
  }

  async append(path: string, data: string | Uint8Array): Promise<void> {
    const chunk = encode(data);
    if (await this.exists(path)) {
      await this.put(path, concat(await this.get(path), chunk));
      return;
    }
    await this.put(path, chunk);
  }

  async prepend(path: string, data: string | Uint8Array): Promise<void> {
    const chunk = encode(data);
    if (await this.exists(path)) {
      await this.put(path, concat(chunk, await this.get(path)));
      return;
    }
    await this.put(path, chunk);
  }

  async putFile(
    path: string,
    file: FilesystemFileSource,
    options?: FilesystemPutFileOptions,
  ): Promise<string> {
    return this.putFileAs(path, file, resolveFileName(file), options);
  }

  async putFileAs(
    path: string,
    file: FilesystemFileSource,
    name: string,
    options?: FilesystemPutFileOptions,
  ): Promise<string> {
    const dir = path.replace(/^\/+|\/+$/g, "");
    const target = dir ? `${dir}/${name}` : name;
    await this.put(target, await resolveContents(file));
    const visibility = visibilityFromOptions(options);
    if (visibility) await this.setVisibility(target, visibility);
    return target;
  }

  async readStream(path: string): Promise<ReadableStream<Uint8Array>> {
    const data = await this.get(path);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
  }

  async writeStream(
    path: string,
    stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const chunks: Uint8Array[] = [];
    if (Symbol.asyncIterator in stream) {
      for await (const chunk of stream) chunks.push(chunk);
    } else {
      // `ReadableStream` may also declare `[Symbol.asyncIterator]` in some lib
      // versions, which narrows the `in` check above to `never` here even
      // though this branch is only reached for a real ReadableStream.
      const reader = (stream as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    await this.put(path, merged);
  }

  providesTemporaryUrls(): boolean {
    return false;
  }

  providesTemporaryUploadUrls(): boolean {
    return false;
  }

  async temporaryUrl(_path: string, _expiration?: Date): Promise<string> {
    throw new Error("This driver does not support creating temporary URLs.");
  }

  async temporaryUploadUrl(
    _path: string,
    _expiration?: Date,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    throw new Error(
      "This driver does not support creating temporary upload URLs.",
    );
  }

  async checksum(path: string, algorithm = "md5"): Promise<string> {
    const algo = algorithm.toLowerCase().replace("-", "");
    const hash = createHash(algo === "sha256" ? "sha256" : algo === "sha1" ? "sha1" : "md5");
    hash.update(await this.get(path));
    return hash.digest("hex");
  }

  async json<T = unknown>(path: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.get(path))) as T;
  }

  async getVisibility(path: string): Promise<FilesystemVisibility> {
    return this.#visibility.get(path) ?? "public";
  }

  async setVisibility(
    path: string,
    visibility: FilesystemVisibility,
  ): Promise<void> {
    this.#visibility.set(path, visibility);
  }

  async download(
    path: string,
    name?: string,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return this.response(path, name, headers, "attachment");
  }

  async response(
    path: string,
    name?: string,
    headers: HeadersInitLike = {},
    disposition = "inline",
  ): Promise<Response> {
    const data = await this.get(path);
    const filename = name ?? path.split("/").pop() ?? "file";
    const h = new Headers(headers);
    if (!h.has("Content-Type")) {
      h.set("Content-Type", await this.mimeType(path));
    }
    if (!h.has("Content-Disposition")) {
      h.set("Content-Disposition", `${disposition}; filename="${filename}"`);
    }
    return new Response(data, { headers: h });
  }

  when(
    condition: boolean | ((disk: this) => boolean),
    callback: (disk: this) => unknown,
    defaultCallback?: (disk: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    if (pass) callback(this);
    else if (defaultCallback) defaultCallback(this);
    return this;
  }

  unless(
    condition: boolean | ((disk: this) => boolean),
    callback: (disk: this) => unknown,
    defaultCallback?: (disk: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    return this.when(!pass, callback, defaultCallback);
  }
}
