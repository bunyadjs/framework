import { processWithBun, probeWithBun } from "./bun-driver.ts";
import { canProcessWithBun } from "./encode-utils.ts";
import {
  dominantColorWithSharp,
  processWithSharp,
  probeWithSharp,
} from "./sharp-driver.ts";
import type {
  EncodeOptions,
  ProcessedImage,
  Transform,
} from "./types.ts";

export type ImageDriverName = "bun" | "sharp";

/** Which backend will run this pipeline (for tests / diagnostics). */
export function selectImageDriver(
  transforms: Transform[],
  encode: EncodeOptions = {},
): ImageDriverName {
  return canProcessWithBun(transforms, encode) ? "bun" : "sharp";
}

/**
 * Prefer Bun.Image for supported resize/flip/encode paths; fall back to sharp
 * for cover/contain/crop/blur/sharpen/dominant and formats Bun cannot encode.
 */
export async function processImage(
  input: Uint8Array,
  transforms: Transform[],
  encode: EncodeOptions = {},
): Promise<ProcessedImage> {
  if (canProcessWithBun(transforms, encode)) {
    try {
      return await processWithBun(input, transforms, encode);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      // OS-backed formats (e.g. AVIF) may reject on this machine.
      if (code !== "ERR_IMAGE_FORMAT_UNSUPPORTED") {
        throw error;
      }
    }
  }
  return processWithSharp(input, transforms, encode);
}

/** Source metadata — Bun.Image (fast); sharp if Bun cannot sniff the bytes. */
export async function probeImage(
  input: Uint8Array,
): Promise<{ width: number; height: number; format?: string }> {
  try {
    return await probeWithBun(input);
  } catch {
    return probeWithSharp(input);
  }
}

export async function dominantColor(
  input: Uint8Array,
): Promise<string> {
  return dominantColorWithSharp(input);
}
