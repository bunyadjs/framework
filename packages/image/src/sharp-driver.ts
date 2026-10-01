import sharp from "sharp";
import {
  extensionFor,
  mimeFor,
  normalizeFormat,
} from "./encode-utils.ts";
import type {
  EncodeOptions,
  ImageFormat,
  ProcessedImage,
  Transform,
} from "./types.ts";

async function dominantFrom(
  input: Uint8Array,
): Promise<{ r: number; g: number; b: number }> {
  const { dominant } = await sharp(input, { failOn: "none" }).stats();
  return { r: dominant.r, g: dominant.g, b: dominant.b };
}

/**
 * Matches sharp's own `sharp.Color` (a CSS-like string or an RGBA object) --
 * referenced structurally instead of via the `sharp` namespace, which
 * doesn't resolve under this project's `moduleResolution: "bundler"`.
 */
type SharpColor = string | { r: number; g: number; b: number; alpha?: number };

function parseBackground(
  color: string | undefined,
  dominant?: { r: number; g: number; b: number },
): SharpColor | undefined {
  if (!color) return undefined;
  if (color === "dominant") {
    return dominant
      ? { r: dominant.r, g: dominant.g, b: dominant.b, alpha: 1 }
      : undefined;
  }
  return color;
}

/**
 * Apply the transform pipeline with sharp and return encoded bytes.
 */
export async function processWithSharp(
  input: Uint8Array,
  transforms: Transform[],
  encode: EncodeOptions = {},
): Promise<ProcessedImage> {
  // `orient()` applies EXIF orientation. Without it, keep pixels as stored.
  let pipeline = sharp(input, { failOn: "none" });

  const needsDominant = transforms.some(
    (t) =>
      (t.op === "contain" || t.op === "rotate") && t.background === "dominant",
  );
  const dominant = needsDominant ? await dominantFrom(input) : undefined;

  for (const t of transforms) {
    switch (t.op) {
      case "orient":
        pipeline = pipeline.rotate();
        break;
      case "resize":
        pipeline = pipeline.resize({
          width: t.width,
          height: t.height,
          fit: t.width != null && t.height != null ? "fill" : "inside",
          withoutEnlargement: false,
        });
        break;
      case "scale":
        pipeline = pipeline.resize({
          width: t.width,
          height: t.height,
          fit: "inside",
          withoutEnlargement: true,
        });
        break;
      case "cover":
        pipeline = pipeline.resize({
          width: t.width,
          height: t.height,
          fit: "cover",
          position: "centre",
        });
        break;
      case "contain": {
        const bg =
          parseBackground(t.background, dominant) ?? {
            r: 255,
            g: 255,
            b: 255,
            alpha: 1,
          };
        pipeline = pipeline.resize({
          width: t.width,
          height: t.height,
          fit: "contain",
          background: bg,
        });
        break;
      }
      case "crop": {
        const meta = await pipeline.toBuffer({ resolveWithObject: true });
        pipeline = sharp(meta.data);
        const left =
          t.x ?? Math.max(0, Math.floor((meta.info.width - t.width) / 2));
        const top =
          t.y ?? Math.max(0, Math.floor((meta.info.height - t.height) / 2));
        pipeline = pipeline.extract({
          left: Math.max(0, left),
          top: Math.max(0, top),
          width: Math.min(t.width, meta.info.width),
          height: Math.min(t.height, meta.info.height),
        });
        break;
      }
      case "rotate":
        pipeline = pipeline.rotate(t.degrees, {
          background: parseBackground(t.background, dominant) ?? {
            r: 255,
            g: 255,
            b: 255,
            alpha: 1,
          },
        });
        break;
      case "blur":
        // sharp sigma ~ 0.3–1000; map 0–100 roughly
        pipeline = pipeline.blur(Math.max(0.3, (t.amount / 100) * 20));
        break;
      case "sharpen":
        pipeline = pipeline.sharpen({
          sigma: Math.max(0.1, (t.amount / 100) * 5),
        });
        break;
      case "grayscale":
        pipeline = pipeline.grayscale();
        break;
      case "flipVertically":
        pipeline = pipeline.flip();
        break;
      case "flipHorizontally":
        pipeline = pipeline.flop();
        break;
    }
  }

  const format = normalizeFormat(encode.format);
  const quality =
    encode.quality != null
      ? Math.min(100, Math.max(1, Math.round(encode.quality)))
      : undefined;

  if (format === "jpeg") {
    pipeline = pipeline.jpeg({ quality: quality ?? 80, mozjpeg: true });
  } else if (format === "png") {
    pipeline = pipeline.png({ quality: quality ?? 80 });
  } else if (format === "webp") {
    pipeline = pipeline.webp({ quality: quality ?? 80 });
  } else if (format === "avif") {
    pipeline = pipeline.avif({ quality: quality ?? 50 });
  } else if (format === "gif") {
    pipeline = pipeline.gif();
  } else if (format === "bmp") {
    // sharp has limited bmp encode — fall back to png if needed
    pipeline = pipeline.png();
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const outFormat = (normalizeFormat(format) ??
    (info.format as ImageFormat) ??
    "png") as ImageFormat;
  const resolvedFormat =
    outFormat === "jpg"
      ? "jpeg"
      : outFormat === "bmp" && !format
        ? "png"
        : outFormat;

  return {
    bytes: new Uint8Array(data),
    width: info.width,
    height: info.height,
    mimeType: mimeFor(resolvedFormat === "jpeg" ? "jpeg" : resolvedFormat),
    extension: extensionFor(
      resolvedFormat === "jpeg" ? "jpeg" : resolvedFormat,
    ),
    // resolvedFormat is already normalized away from "jpg" above (line 174-179).
    format: resolvedFormat,
  };
}

/** Read width/height without applying transforms (source metadata). */
export async function probeWithSharp(
  input: Uint8Array,
): Promise<{ width: number; height: number; format?: string }> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format,
  };
}

/** Dominant RGB of the source image. */
export async function dominantColorWithSharp(
  input: Uint8Array,
): Promise<string> {
  const { r, g, b } = await dominantFrom(input);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}
