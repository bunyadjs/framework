import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { gunzip, gzip, gzipStream, isGzip } from "./gzip.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

test("gzip round-trip + node:zlib interop", async () => {
  const xml = "<url><loc>https://example.com/ü</loc></url>".repeat(1000);
  const packed = await gzip(xml);
  assert.ok(isGzip(packed));
  assert.equal(dec.decode(await gunzip(packed)), xml);
  assert.equal(gunzipSync(packed).toString("utf8"), xml);
  assert.equal(dec.decode(await gunzip(new Uint8Array(gzipSync(xml)))), xml);
});

test("gzipStream over an async iterable", async () => {
  async function* parts() {
    yield enc.encode("<a>");
    yield enc.encode("</a>");
  }
  const out = new Uint8Array(
    await new Response(gzipStream(parts())).arrayBuffer(),
  );
  assert.equal(dec.decode(await gunzip(out)), "<a></a>");
  await assert.rejects(gunzip(enc.encode("nope")));
});
