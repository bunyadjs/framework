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

function applyEncode(
  pipeline: Bun.Image,
  format: ImageFormat | undefined,
  quality: number | undefined,
): Bun.Image {
  const q =
    quality != null
      ? Math.min(100, Math.max(1, Math.round(quality)))
      : undefined;

  if (format === "jpeg") {
    return pipeline.jpeg({ quality: q ?? 80 });
  }
  if (format === "png") {
    return pipeline.png();
  }
  if (format === "webp") {
    return pipeline.webp({ quality: q ?? 80 });
  }
  if (format === "avif") {
    return pipeline.avif({ quality: q ?? 50 });
  }
  return pipeline;
}

/**
 * Apply the transform pipeline with Bun.Image and return encoded bytes.
 */
export async function processWithBun(
  input: Uint8Array,
  transforms: Transform[],
  encode: EncodeOptions = {},
): Promise<ProcessedImage> {
  const autoOrient = transforms.some((t) => t.op === "orient");
  let pipeline = new Bun.Image(input, { autoOrient });

  for (const t of transforms) {
    switch (t.op) {
      case "orient":
        break;
      case "resize":
        if (t.width != null && t.height != null) {
          pipeline = pipeline.resize(t.width, t.height);
        } else if (t.width != null) {
          pipeline = pipeline.resize(t.width);
        }
        break;
      case "scale":
        if (t.width != null && t.height != null) {
          pipeline = pipeline.resize(t.width, t.height, {
            fit: "inside",
            withoutEnlargement: true,
          });
        } else if (t.width != null) {
          pipeline = pipeline.resize(t.width, undefined, {
            fit: "inside",
            withoutEnlargement: true,
          });
        }
        break;
      case "rotate": {
        const degrees = ((t.degrees % 360) + 360) % 360;
        if (degrees !== 0) {
          pipeline = pipeline.rotate(degrees);
        }
        break;
      }
      case "grayscale":
        pipeline = pipeline.modulate({ saturation: 0 });
        break;
      case "flipVertically":
        pipeline = pipeline.flip();
        break;
      case "flipHorizontally":
        pipeline = pipeline.flop();
        break;
      default:
        throw new Error(
          `Bun.Image cannot apply transform [${(t as Transform).op}].`,
        );
    }
  }

  const format = normalizeFormat(encode.format);
  pipeline = applyEncode(pipeline, format, encode.quality);

  const data = await pipeline.bytes();
  const width = pipeline.width;
  const height = pipeline.height;

  let resolvedFormat = (format ?? "png") as ImageFormat;
  if (!format) {
    const meta = await new Bun.Image(input, { autoOrient: false }).metadata();
    if (meta.format) {
      resolvedFormat = normalizeFormat(meta.format as ImageFormat) ?? "png";
    }
  }

  const outFormat = resolvedFormat === "jpg" ? "jpeg" : resolvedFormat;

  return {
    bytes: data instanceof Uint8Array ? data : new Uint8Array(data),
    width,
    height,
    mimeType: mimeFor(outFormat),
    extension: extensionFor(outFormat),
    format: outFormat,
  };
}

/** Read width/height without applying transforms (source metadata). */
export async function probeWithBun(
  input: Uint8Array,
): Promise<{ width: number; height: number; format?: string }> {
  const meta = await new Bun.Image(input, { autoOrient: false }).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format,
  };
}
