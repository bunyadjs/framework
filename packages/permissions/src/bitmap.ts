/** A set of permission ids as 32-bit words. Bit `id` lives in word `id >>> 5`. */
export type Bitmap = Uint32Array;

const wordsFor = (bits: number): number => Math.max(1, (bits + 31) >>> 5);

export function emptyBitmap(bits = 32): Bitmap {
  return new Uint32Array(wordsFor(bits));
}

/** Set a bit, growing the bitmap if needed. Returns the (possibly new) bitmap. */
export function setBit(map: Bitmap, id: number): Bitmap {
  const word = id >>> 5;
  if (word >= map.length) {
    const grown = new Uint32Array(word + 1);
    grown.set(map);
    map = grown;
  }
  map[word] = (map[word]! | (1 << (id & 31))) >>> 0;
  return map;
}

export function hasBit(map: Bitmap, id: number): boolean {
  const word = id >>> 5;
  return word < map.length && ((map[word]! >>> (id & 31)) & 1) === 1;
}

/** `target |= source`, growing the target if needed. Returns the (possibly new) target. */
export function orInto(target: Bitmap, source: Bitmap): Bitmap {
  if (source.length > target.length) {
    const grown = new Uint32Array(source.length);
    grown.set(target);
    target = grown;
  }
  for (let i = 0; i < source.length; i++) target[i] = (target[i]! | source[i]!) >>> 0;
  return target;
}

export function bitmapIds(map: Bitmap): number[] {
  const ids: number[] = [];
  for (let w = 0; w < map.length; w++) {
    let word = map[w]!;
    while (word !== 0) {
      const low = 31 - Math.clz32(word & -word);
      ids.push((w << 5) + low);
      word &= word - 1;
    }
  }
  return ids;
}

export function bitmapToBase64(map: Bitmap): string {
  return Buffer.from(map.buffer, map.byteOffset, map.byteLength).toString("base64");
}

export function bitmapFromBase64(value: string): Bitmap {
  const bytes = Buffer.from(value, "base64");
  const padded = new Uint8Array(Math.max(4, Math.ceil(bytes.length / 4) * 4));
  padded.set(bytes);
  return new Uint32Array(padded.buffer);
}
