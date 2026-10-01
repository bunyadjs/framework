import { basename } from "node:path";

/**
 * Uploaded file from multipart form data (`UploadedFile`).
 */
export class UploadedFile {
  readonly #blob: Blob;
  readonly #clientOriginalName: string;
  readonly #error: string | null;

  constructor(blob: Blob, clientOriginalName: string, error: string | null = null) {
    this.#blob = blob;
    this.#clientOriginalName = clientOriginalName;
    this.#error = error;
  }

  /** Original client filename. */
  getClientOriginalName(): string {
    return this.#clientOriginalName;
  }

  /** Extension of the original client filename (without dot). */
  getClientOriginalExtension(): string {
    const name = this.#clientOriginalName;
    const i = name.lastIndexOf(".");
    if (i <= 0 || i === name.length - 1) return "";
    return name.slice(i + 1);
  }

  /** Alias used by validators. */
  clientOriginalExtension(): string {
    return this.getClientOriginalExtension();
  }

  /** Client MIME type. */
  get mimeType(): string {
    return this.#blob.type || "application/octet-stream";
  }

  getClientMimeType(): string {
    return this.mimeType;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  /** Size in bytes. */
  get size(): number {
    return this.#blob.size;
  }

  getSize(): number {
    return this.size;
  }

  /** Extension of the client filename (Laravel `extension` / `clientExtension`). */
  extension(): string {
    return this.getClientOriginalExtension();
  }

  clientExtension(): string {
    return this.getClientOriginalExtension();
  }

  guessExtension(): string {
    return this.getClientOriginalExtension();
  }

  getFilename(): string {
    return this.#clientOriginalName;
  }

  /** Generated hash filename (Laravel `hashName`). */
  hashName(path = ""): string {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const hash = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    const ext = this.getClientOriginalExtension();
    const name = ext ? `${hash}.${ext}` : hash;
    return path ? `${path.replace(/\/$/, "")}/${name}` : name;
  }

  /** Whether the upload completed without error. */
  isValid(): boolean {
    return this.#error == null;
  }

  getError(): string | null {
    return this.#error;
  }

  /** Image pixel dimensions when the file is a PNG/JPEG/GIF/WebP, else null. */
  async dimensions(): Promise<{ width: number; height: number } | null> {
    try {
      const bytes = await this.bytes();
      if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
        const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
        const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
        return { width, height };
      }
      if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let i = 2;
        while (i < bytes.length - 8) {
          if (bytes[i] !== 0xff) break;
          const marker = bytes[i + 1]!;
          const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
          if (marker === 0xc0 || marker === 0xc2) {
            const height = (bytes[i + 5]! << 8) | bytes[i + 6]!;
            const width = (bytes[i + 7]! << 8) | bytes[i + 8]!;
            return { width, height };
          }
          i += 2 + len;
        }
      }
      if (
        bytes.length >= 30 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45
      ) {
        const width = bytes[26]! | (bytes[27]! << 8) | (bytes[28]! << 16) | (bytes[29]! << 24);
        const height = bytes[30]! | (bytes[31]! << 8) | (bytes[32]! << 16) | (bytes[33]! << 24);
        return { width: width + 1, height: height + 1 };
      }
    } catch {
      return null;
    }
    return null;
  }

  /** Local path placeholder (in-memory uploads have none). */
  path(): string {
    return this.#clientOriginalName;
  }

  /** Read a metadata key (size / mime / client name). */
  get(key: string): unknown {
    if (key === "size") return this.size;
    if (key === "mime" || key === "mimeType") return this.mimeType;
    if (key === "name" || key === "clientOriginalName") return this.#clientOriginalName;
    return undefined;
  }

  /** Read file bytes. */
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.#blob.arrayBuffer();
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.arrayBuffer());
  }

  /**
   * Store on the default disk under `directory` with a generated name.
   * Returns the relative path.
   */
  async store(directory = "", options: { disk?: string } = {}): Promise<string> {
    const name = this.hashName().split("/").pop()!;
    return this.storeAs(directory, name, options);
  }

  /**
   * Store on disk as `directory/name`.
   */
  async storeAs(
    directory: string,
    name: string,
    options: { disk?: string } = {},
  ): Promise<string> {
    const safeName = basename(name);
    if (
      safeName !== name ||
      safeName === "" ||
      safeName === "." ||
      safeName === ".."
    ) {
      throw new Error(
        `Invalid upload filename: [${name}] must be a basename without path segments.`,
      );
    }
    const path = [directory.replace(/\/$/, ""), safeName].filter(Boolean).join("/");
    const { Storage } = await import("@bunyad/filesystem");
    const contents = await this.bytes();
    if (options.disk) {
      await Storage.disk(options.disk).put(path, contents);
    } else {
      await Storage.put(path, contents);
    }
    return path;
  }

  /** Store on the public disk (Laravel `storePublicly`). */
  async storePublicly(
    directory = "",
    options: { disk?: string } = {},
  ): Promise<string> {
    return this.store(directory, { disk: options.disk ?? "public" });
  }

  /** Store on the public disk with a fixed name (Laravel `storePubliclyAs`). */
  async storePubliclyAs(
    directory: string,
    name: string,
    options: { disk?: string } = {},
  ): Promise<string> {
    return this.storeAs(directory, name, { disk: options.disk ?? "public" });
  }

  /** Build from a Fetch `File` (multipart). */
  static fromFile(file: File): UploadedFile {
    return new UploadedFile(file, file.name);
  }

  /** Create a fake upload for tests (Laravel `UploadedFile::fake`). */
  static fake(): {
    create(name: string, content?: string | Uint8Array, mime?: string): UploadedFile;
    image(name: string, width?: number, height?: number): UploadedFile;
  } {
    return {
      create(name, content = "", mime = "application/octet-stream") {
        const body =
          typeof content === "string"
            ? new TextEncoder().encode(content)
            : content;
        return new UploadedFile(
          new Blob([body], { type: mime }),
          name,
        );
      },
      image(name, _width = 10, _height = 10) {
        // Minimal 1x1 PNG
        const png = Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
          0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xff, 0xff, 0x3f,
          0x00, 0x05, 0xfe, 0x02, 0xfe, 0xdc, 0xcc, 0x59, 0xe7, 0x00, 0x00, 0x00,
          0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]);
        return new UploadedFile(new Blob([png], { type: "image/png" }), name);
      },
    };
  }
}
