/**
 * gzip helpers on the web `CompressionStream` API (Bun, Node ≥ 22.6).
 * Zero dependencies; streaming-first so large sitemap parts never sit in memory.
 */

export type ByteSource =
  ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

function toReadable(source: ByteSource): ReadableStream<Uint8Array> {
  if (source instanceof ReadableStream) return source;
  const iterator =
    Symbol.asyncIterator in source
      ? (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
      : (source as Iterable<Uint8Array>)[Symbol.iterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

function pipe(
  source: ByteSource,
  transform: CompressionStream | DecompressionStream,
): ReadableStream<Uint8Array> {
  return toReadable(source).pipeThrough(
    transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
}

/** Lazily gzip a byte stream (back-pressure preserved; nothing buffered). */
export function gzipStream(source: ByteSource): ReadableStream<Uint8Array> {
  return pipe(source, new CompressionStream("gzip"));
}

/** Lazily gunzip a byte stream. */
export function gunzipStream(source: ByteSource): ReadableStream<Uint8Array> {
  return pipe(source, new DecompressionStream("gzip"));
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const encoder = new TextEncoder();

/** gzip a whole buffer or string (small payloads, e.g. a single response). */
export function gzip(
  data: Uint8Array | string,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  return collect(gzipStream([bytes]));
}

/** gunzip a whole buffer. */
export function gunzip(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return collect(gunzipStream([data]));
}

/** True when `data` starts with the gzip magic bytes (1f 8b). */
export function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}
