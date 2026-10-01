import { PendingImage } from "./pending-image.ts";
import type { UploadedFile } from "./types.ts";

/**
 * Fluent image facade — create pipelines from uploads, paths, Storage, URLs, or bytes.
 */
export const Image = {
  fromBytes(contents: Uint8Array | ArrayBuffer | Buffer): PendingImage {
    const bytes =
      contents instanceof Uint8Array
        ? contents
        : new Uint8Array(contents as ArrayBuffer);
    return PendingImage.fromSource({ kind: "bytes", bytes });
  },

  fromBase64(value: string): PendingImage {
    const cleaned = value.replace(/^data:[^;]+;base64,/, "");
    return Image.fromBytes(Buffer.from(cleaned, "base64"));
  },

  fromPath(path: string): PendingImage {
    return PendingImage.fromSource({ kind: "path", path });
  },

  fromUrl(url: string): PendingImage {
    return PendingImage.fromSource({ kind: "url", url });
  },

  fromStorage(path: string, disk?: string): PendingImage {
    return PendingImage.fromSource({ kind: "storage", path, disk });
  },

  fromUpload(file: UploadedFile): PendingImage {
    return PendingImage.fromSource({ kind: "upload", file }, file);
  },

  /** Read an uploaded file, path string, Storage path, URL, or raw bytes. */
  read(
    input: UploadedFile | string | Uint8Array | ArrayBuffer | Buffer,
  ): PendingImage {
    if (typeof input === "string") {
      if (/^https?:\/\//i.test(input)) return Image.fromUrl(input);
      return Image.fromPath(input);
    }
    if (
      input != null &&
      typeof input === "object" &&
      "getClientOriginalName" in input
    ) {
      return Image.fromUpload(input as UploadedFile);
    }
    return Image.fromBytes(input as Uint8Array | ArrayBuffer | Buffer);
  },
};

export type { PendingImage };
