import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileDebugbarStore } from "../src/file-store.ts";
import type { Snapshot } from "../src/types.ts";

const dirs: string[] = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "debugbar-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

let n = 0;
function snap(overrides: Partial<Snapshot> & { at?: number } = {}): Snapshot {
  const id = (++n).toString(16).padStart(16, "0");
  const at = overrides.at ?? Date.now() + n;
  return { id, collectedAt: new Date(at).toISOString(), ...overrides } as Snapshot;
}

test("round-trips through disk and is visible to a second instance", async () => {
  const dir = await tempDir();
  const writer = new FileDebugbarStore(dir);
  const a = snap();
  writer.put(a);
  await writer.flush();

  const reader = new FileDebugbarStore(dir); // a different process, in effect
  expect((await reader.get(a.id))?.id).toBe(a.id);
  expect((await reader.list()).map((s) => s.id)).toEqual([a.id]);
});

test("lists newest first and honours the limit", async () => {
  const store = new FileDebugbarStore(await tempDir());
  const now = Date.now();
  const [a, b, c] = [snap({ at: now - 3000 }), snap({ at: now - 2000 }), snap({ at: now - 1000 })];
  for (const s of [a, b, c]) store.put(s);
  await store.flush();

  const fresh = new FileDebugbarStore(store.directory);
  expect((await fresh.list()).map((s) => s.id)).toEqual([c.id, b.id, a.id]);
  expect((await fresh.list(2)).map((s) => s.id)).toEqual([c.id, b.id]);
});

test("prunes to capacity, oldest first", async () => {
  const dir = await tempDir();
  const store = new FileDebugbarStore(dir, { capacity: 2 });
  const items = [snap(), snap(), snap(), snap()];
  for (const s of items) store.put(s);
  await store.flush();

  const files = await readdir(dir);
  expect(files).toHaveLength(2);
  const reader = new FileDebugbarStore(dir, { capacity: 2 });
  expect((await reader.list()).map((s) => s.id)).toEqual([items[3]!.id, items[2]!.id]);
});

test("prunes snapshots older than maxAge", async () => {
  const dir = await tempDir();
  const store = new FileDebugbarStore(dir, { maxAgeMs: 60_000 });
  store.put(snap({ at: Date.now() - 10 * 60_000 }));
  store.put(snap());
  await store.flush();
  expect(await readdir(dir)).toHaveLength(1);
});

test("rejects ids that are not 16 hex characters (no path traversal)", async () => {
  const dir = await tempDir();
  const store = new FileDebugbarStore(dir);
  await writeFile(join(dir, "secret.json"), "{}");
  expect(await store.get("../secret")).toBeUndefined();
  expect(await store.get("..%2fsecret")).toBeUndefined();
  expect(await store.get("zzzzzzzzzzzzzzzz")).toBeUndefined();
});

test("skips corrupt and temp files", async () => {
  const dir = await tempDir();
  const store = new FileDebugbarStore(dir);
  const good = snap();
  store.put(good);
  await store.flush();
  await writeFile(join(dir, `${String(Date.now() + 5000).padStart(13, "0")}-${"a".repeat(16)}.json`), "{not json");
  await writeFile(join(dir, `${String(Date.now()).padStart(13, "0")}-${"b".repeat(16)}.json.tmp`), "{}");

  const reader = new FileDebugbarStore(dir);
  expect((await reader.list()).map((s) => s.id)).toEqual([good.id]);
  expect(await reader.get("a".repeat(16))).toBeUndefined();
});

test("concurrent puts all land", async () => {
  const store = new FileDebugbarStore(await tempDir(), { capacity: 100 });
  const items = Array.from({ length: 30 }, () => snap());
  await Promise.all(items.map((s) => store.put(s)));
  await store.flush();
  const reader = new FileDebugbarStore(store.directory, { capacity: 100 });
  expect(await reader.list(100)).toHaveLength(30);
});

test("clear empties memory and disk; files are private", async () => {
  const dir = await tempDir();
  const store = new FileDebugbarStore(dir);
  store.put(snap());
  await store.flush();
  const [file] = await readdir(dir);
  expect((await stat(join(dir, file!))).mode & 0o777).toBe(0o600);

  await store.clear();
  expect(await readdir(dir)).toEqual([]);
  expect(await store.list()).toEqual([]);
});

test("a missing directory lists as empty", async () => {
  const store = new FileDebugbarStore(join(await tempDir(), "nope"));
  expect(await store.list()).toEqual([]);
});
