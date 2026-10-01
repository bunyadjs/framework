import { readFileSync } from "node:fs";
import { Storage } from "@bunyad/filesystem";
import { dominantColor, probeImage, processImage } from "./process.ts";
import type {
  EncodeOptions,
  ImageFormat,
  ImageSource,
  ProcessedImage,
  Transform,
  UploadedFile,
} from "./types.ts";

type ResizeArgs =
  | [width?: number, height?: number]
  | [options: { width?: number; height?: number }];

function resizeDims(
  ...args: ResizeArgs
): { width?: number; height?: number } {
  if (args.length === 1 && args[0] && typeof args[0] === "object") {
    return args[0];
  }
  return { width: args[0] as number | undefined, height: args[1] as number | undefined };
}

/**
 * Fluent, immutable image pipeline.
 */
export class PendingImage {
  readonly #source: ImageSource;
  readonly #transforms: Transform[];
  readonly #encode: EncodeOptions;
  readonly #upload: UploadedFile | undefined;
  #hashStem: string | undefined;
  #resolved: Uint8Array | undefined;
  #processed: ProcessedImage | undefined;

  private constructor(
    source: ImageSource,
    transforms: Transform[] = [],
    encode: EncodeOptions = {},
    upload?: UploadedFile,
    resolved?: Uint8Array,
    hashStem?: string,
  ) {
    this.#source = source;
    this.#transforms = transforms;
    this.#encode = encode;
    this.#upload = upload;
    this.#resolved = resolved;
    this.#hashStem = hashStem;
  }

  static fromSource(source: ImageSource, upload?: UploadedFile): PendingImage {
    return new PendingImage(source, [], {}, upload);
  }

  /** Underlying uploaded file when created via `fromUpload`. */
  file(): UploadedFile | undefined {
    return this.#upload;
  }

  #clone(
    transforms = this.#transforms,
    encode = this.#encode,
  ): PendingImage {
    return new PendingImage(
      this.#source,
      transforms,
      encode,
      this.#upload,
      this.#resolved,
      this.#hashStem,
    );
  }

  #withTransform(transform: Transform): PendingImage {
    return this.#clone([...this.#transforms, transform], this.#encode);
  }

  /**
   * Append a transform object, or apply a named fluent transform
   * (`transform("cover", 100, 100)`).
   */
  transform(transformation: Transform): PendingImage;
  transform(name: string, ...args: unknown[]): PendingImage;
  transform(
    nameOrTransformation: string | Transform,
    ...args: unknown[]
  ): PendingImage {
    if (typeof nameOrTransformation === "object") {
      return this.#withTransform(nameOrTransformation);
    }
    const fn = (this as unknown as Record<string, unknown>)[nameOrTransformation];
    if (typeof fn !== "function") {
      throw new Error(`Unknown image transform [${nameOrTransformation}].`);
    }
    return (fn as (...a: unknown[]) => PendingImage).apply(this, args);
  }

  resize(width?: number, height?: number): PendingImage;
  resize(options: { width?: number; height?: number }): PendingImage;
  resize(...args: ResizeArgs): PendingImage {
    const { width, height } = resizeDims(...args);
    return this.#withTransform({ op: "resize", width, height });
  }

  scale(width?: number, height?: number): PendingImage;
  scale(options: { width?: number; height?: number }): PendingImage;
  scale(...args: ResizeArgs): PendingImage {
    const { width, height } = resizeDims(...args);
    return this.#withTransform({ op: "scale", width, height });
  }

  cover(width: number, height: number): PendingImage {
    return this.#withTransform({ op: "cover", width, height });
  }

  contain(width: number, height: number, background?: string): PendingImage {
    return this.#withTransform({ op: "contain", width, height, background });
  }

  crop(width: number, height: number, x?: number, y?: number): PendingImage;
  crop(
    width: number,
    height: number,
    options: { x?: number; y?: number },
  ): PendingImage;
  crop(
    width: number,
    height: number,
    xOrOptions?: number | { x?: number; y?: number },
    y?: number,
  ): PendingImage {
    if (typeof xOrOptions === "object" && xOrOptions != null) {
      return this.#withTransform({
        op: "crop",
        width,
        height,
        x: xOrOptions.x,
        y: xOrOptions.y,
      });
    }
    return this.#withTransform({
      op: "crop",
      width,
      height,
      x: xOrOptions,
      y,
    });
  }

  orient(): PendingImage {
    return this.#withTransform({ op: "orient" });
  }

  /** Alias for {@link orient}. */
  orientate(): PendingImage {
    return this.orient();
  }

  rotate(degrees: number, background?: string): PendingImage {
    return this.#withTransform({ op: "rotate", degrees, background });
  }

  blur(amount = 10): PendingImage {
    return this.#withTransform({ op: "blur", amount });
  }

  sharpen(amount = 10): PendingImage {
    return this.#withTransform({ op: "sharpen", amount });
  }

  grayscale(): PendingImage {
    return this.#withTransform({ op: "grayscale" });
  }

  flipVertically(): PendingImage {
    return this.#withTransform({ op: "flipVertically" });
  }

  flipHorizontally(): PendingImage {
    return this.#withTransform({ op: "flipHorizontally" });
  }

  /** Flip vertically. */
  flip(): PendingImage {
    return this.flipVertically();
  }

  /** Flip horizontally. */
  flop(): PendingImage {
    return this.flipHorizontally();
  }

  when(
    condition: unknown,
    callback: (image: PendingImage) => PendingImage,
  ): PendingImage {
    return condition ? callback(this) : this;
  }

  unless(
    condition: unknown,
    callback: (image: PendingImage) => PendingImage,
  ): PendingImage {
    return !condition ? callback(this) : this;
  }

  /** Return a pipeline copy with the same source/transforms. */
  newClone(): PendingImage {
    return this.#clone();
  }

  withClone(callback: (image: PendingImage) => PendingImage): PendingImage {
    return callback(this.#clone());
  }

  /** Create a clone with updated encode options. */
  withOutput(
    callback: (encode: EncodeOptions) => EncodeOptions | void,
  ): PendingImage {
    const next = { ...this.#encode };
    const result = callback(next);
    return this.#clone(this.#transforms, result ?? next);
  }

  /** Set the output format. */
  toFormat(format: ImageFormat, quality?: number): PendingImage {
    const normalized = format === "jpg" ? "jpeg" : format;
    return this.withOutput((encode) => {
      encode.format = normalized;
      if (quality !== undefined) encode.quality = quality;
    });
  }

  toJpeg(): PendingImage {
    return this.toFormat("jpeg");
  }

  toJpg(): PendingImage {
    return this.toFormat("jpg");
  }

  toPng(): PendingImage {
    return this.toFormat("png");
  }

  toWebp(): PendingImage {
    return this.toFormat("webp");
  }

  toAvif(): PendingImage {
    return this.toFormat("avif");
  }

  toGif(): PendingImage {
    return this.toFormat("gif");
  }

  toBmp(): PendingImage {
    return this.toFormat("bmp");
  }

  quality(value: number): PendingImage {
    return this.withOutput((encode) => {
      encode.quality = value;
    });
  }

  optimize(format: ImageFormat = "webp", quality = 70): PendingImage {
    return this.toFormat(format).quality(quality);
  }

  async #loadBytes(): Promise<Uint8Array> {
    if (this.#resolved) return this.#resolved;
    const source = this.#source;
    let bytes: Uint8Array;
    switch (source.kind) {
      case "bytes":
        bytes = source.bytes;
        break;
      case "path":
        bytes = new Uint8Array(readFileSync(source.path));
        break;
      case "url": {
        const res = await fetch(source.url);
        if (!res.ok) {
          throw new Error(`Failed to fetch image URL (${res.status}).`);
        }
        bytes = new Uint8Array(await res.arrayBuffer());
        break;
      }
      case "storage":
        bytes = source.disk
          ? await Storage.disk(source.disk).get(source.path)
          : await Storage.get(source.path);
        break;
      case "upload":
        bytes = await source.file.bytes();
        break;
    }
    this.#resolved = bytes;
    return bytes;
  }

  async #process(): Promise<ProcessedImage> {
    if (this.#processed) return this.#processed;
    const input = await this.#loadBytes();
    this.#processed = await processImage(
      input,
      this.#transforms,
      this.#encode,
    );
    return this.#processed;
  }

  async toBytes(): Promise<Uint8Array> {
    return (await this.#process()).bytes;
  }

  async toBase64(): Promise<string> {
    const processed = await this.#process();
    return Buffer.from(processed.bytes).toString("base64");
  }

  async toDataUri(): Promise<string> {
    const processed = await this.#process();
    const b64 = Buffer.from(processed.bytes).toString("base64");
    return `data:${processed.mimeType};base64,${b64}`;
  }

  async mimeType(): Promise<string> {
    return (await this.#process()).mimeType;
  }

  async extension(): Promise<string> {
    return (await this.#process()).extension;
  }

  async dimensions(): Promise<[number, number]> {
    const processed = await this.#process();
    return [processed.width, processed.height];
  }

  async width(): Promise<number> {
    return (await this.#process()).width;
  }

  async height(): Promise<number> {
    return (await this.#process()).height;
  }

  /** Dominant RGB hex of the *source* image. */
  async dominantColor(): Promise<string> {
    const input = await this.#loadBytes();
    return dominantColor(input);
  }

  /** Source dimensions before transforms (for validation). */
  async sourceDimensions(): Promise<[number, number]> {
    const input = await this.#loadBytes();
    const meta = await probeImage(input);
    return [meta.width, meta.height];
  }

  /** Hashed filename with the processed extension (`avatars/abc….webp`). */
  async hashName(path = ""): Promise<string> {
    this.#hashStem ??= Array.from(
      crypto.getRandomValues(new Uint8Array(20)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const name = `${this.#hashStem}.${await this.extension()}`;
    return path ? `${path.replace(/\/$/, "")}/${name}` : name;
  }

  async store(
    path = "",
    disk?: string,
  ): Promise<string | false> {
    try {
      const name = (await this.hashName()).split("/").pop()!;
      return await this.storeAs(path, name, disk);
    } catch {
      return false;
    }
  }

  async storeAs(
    path: string,
    name: string,
    disk?: string,
  ): Promise<string | false> {
    try {
      const processed = await this.#process();
      const full = [path.replace(/\/$/, ""), name].filter(Boolean).join("/");
      if (disk) {
        await Storage.disk(disk).put(full, processed.bytes);
      } else {
        await Storage.put(full, processed.bytes);
      }
      return full;
    } catch {
      return false;
    }
  }

  async storePublicly(path = "", disk?: string): Promise<string | false> {
    try {
      const name = (await this.hashName()).split("/").pop()!;
      return await this.storePubliclyAs(path, name, disk);
    } catch {
      return false;
    }
  }

  async storePubliclyAs(
    path: string,
    name: string,
    disk?: string,
  ): Promise<string | false> {
    try {
      const processed = await this.#process();
      const full = [path.replace(/\/$/, ""), name].filter(Boolean).join("/");
      if (disk) {
        await Storage.disk(disk).put(full, processed.bytes);
        await Storage.disk(disk).setVisibility(full, "public");
      } else {
        await Storage.put(full, processed.bytes);
        await Storage.setVisibility(full, "public");
      }
      return full;
    } catch {
      return false;
    }
  }
}
