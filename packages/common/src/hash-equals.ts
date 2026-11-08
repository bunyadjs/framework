import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare two secrets without revealing, through response time, how much of them matched or how
 * long the right one is. Both sides are hashed first, so the comparison always runs over two
 * equal-length buffers. Use it for anything a caller could guess a piece at a time: API keys,
 * reset and recovery codes, signed values.
 *
 * Anything that is not a string is never equal.
 */
export function hashEquals(known: unknown, given: unknown): boolean {
  if (typeof known !== "string" || typeof given !== "string") return false;
  const left = createHash("sha256").update(known, "utf8").digest();
  const right = createHash("sha256").update(given, "utf8").digest();
  return timingSafeEqual(left, right);
}
