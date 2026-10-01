/** Minimal upload surface (avoids a hard dependency cycle on `@bunyad/http`). */
export type UploadedFile = {
  bytes(): Promise<Uint8Array>;
  getClientOriginalName?(): string;
  mimeType?: string;
  getClientMimeType?(): string;
};

export type ImageFormat =
  | "jpeg"
  | "jpg"
  | "png"
  | "webp"
  | "avif"
  | "gif"
  | "bmp";

export type ImageSource =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "path"; path: string }
  | { kind: "url"; url: string }
  | { kind: "storage"; path: string; disk?: string }
  | { kind: "upload"; file: UploadedFile };

export type Transform =
  | { op: "resize"; width?: number; height?: number }
  | { op: "scale"; width?: number; height?: number }
  | { op: "cover"; width: number; height: number }
  | { op: "contain"; width: number; height: number; background?: string }
  | { op: "crop"; width: number; height: number; x?: number; y?: number }
  | { op: "orient" }
  | { op: "rotate"; degrees: number; background?: string }
  | { op: "blur"; amount: number }
  | { op: "sharpen"; amount: number }
  | { op: "grayscale" }
  | { op: "flipVertically" }
  | { op: "flipHorizontally" };

export type EncodeOptions = {
  format?: ImageFormat;
  quality?: number;
};

export type ProcessedImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: string;
  extension: string;
  format: ImageFormat;
};
