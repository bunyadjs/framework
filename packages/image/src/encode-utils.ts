import type { EncodeOptions, ImageFormat, Transform } from "./types.ts";

export function normalizeFormat(format?: ImageFormat): ImageFormat | undefined {
  if (!format) return undefined;
  return format === "jpg" ? "jpeg" : format;
}

export function extensionFor(format: ImageFormat): string {
  if (format === "jpeg" || format === "jpg") return "jpg";
  return format;
}

export function mimeFor(format: ImageFormat): string {
  switch (format) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
  }
}

/**
 * Whether the transform/encode pipeline can run on Bun.Image
 * (faster, no native addon). Unsupported ops fall back to sharp.
 */
export function canProcessWithBun(
  transforms: Transform[],
  encode: EncodeOptions = {},
): boolean {
  const format = normalizeFormat(encode.format);
  if (format === "gif" || format === "bmp") {
    return false;
  }
  // AVIF encode is OS-backed and unavailable on Linux.
  if (format === "avif" && process.platform === "linux") {
    return false;
  }

  for (const t of transforms) {
    switch (t.op) {
      case "orient":
      case "flipVertically":
      case "flipHorizontally":
      case "grayscale":
        break;
      case "resize":
      case "scale":
        // Bun.resize requires a width; height-only needs sharp.
        if (t.width == null) {
          return false;
        }
        break;
      case "rotate": {
        const degrees = ((t.degrees % 360) + 360) % 360;
        if (degrees % 90 !== 0) {
          return false;
        }
        // Custom / dominant fill only matters for non-orthogonal rotates.
        if (t.background === "dominant") {
          return false;
        }
        break;
      }
      default:
        // cover, contain, crop, blur, sharpen
        return false;
    }
  }
  return true;
}
