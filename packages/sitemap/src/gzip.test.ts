import { expect, test } from "bun:test";
import { gunzip, gunzipStream, gzip, gzipStream, isGzip } from "./gzip.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

async function bytesOf(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

test("round-trips strings and bytes (UTF-8, empty)", async () => {
  const text = `<?xml version="1.0" encoding="UTF-8"?><urlset>اردو 中文 😀</urlset>`;
  const packed = await gzip(text);
  expect(isGzip(packed)).toBe(true);
  expect(dec.decode(await gunzip(packed))).toBe(text);
  expect(await gunzip(await gzip(new Uint8Array()))).toEqual(new Uint8Array());
});

test("output is standard gzip (Bun.gunzipSync interop) and compresses", async () => {
  const xml = "<url><loc>https://example.com/p</loc></url>".repeat(10_000);
  const packed = await gzip(xml);
  expect(packed.byteLength).toBeLessThan(xml.length / 20);
  expect(dec.decode(Bun.gunzipSync(packed))).toBe(xml);
  expect(dec.decode(await gunzip(Bun.gzipSync(enc.encode(xml))))).toBe(xml);
});

test("streams async iterables, iterables and ReadableStreams", async () => {
  async function* parts() {
    yield enc.encode("<a>");
    yield enc.encode("b");
    yield enc.encode("</a>");
  }
  expect(dec.decode(await gunzip(await bytesOf(gzipStream(parts()))))).toBe(
    "<a>b</a>",
  );
  expect(
    dec.decode(
      await bytesOf(
        gunzipStream(gzipStream([enc.encode("x"), enc.encode("y")])),
      ),
    ),
  ).toBe("xy");
  const rs = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode("rs"));
      c.close();
    },
  });
  expect(dec.decode(await gunzip(await bytesOf(gzipStream(rs))))).toBe("rs");
});

test("gzipStream is lazy: source is pulled on demand", async () => {
  let pulled = 0;
  function* source() {
    for (let i = 0; i < 1000; i++) {
      pulled++;
      yield enc.encode(`chunk-${i};`);
    }
  }
  const stream = gzipStream(source());
  expect(pulled).toBe(0);
  const out = await bytesOf(stream);
  expect(pulled).toBe(1000);
  expect(dec.decode(await gunzip(out)).split(";").length).toBe(1001);
});

test("corrupt input rejects", async () => {
  await expect(gunzip(enc.encode("not gzip"))).rejects.toThrow();
  expect(isGzip(enc.encode("x"))).toBe(false);
});
