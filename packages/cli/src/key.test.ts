import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAppKey } from "./key.ts";

test("writeAppKey creates .env from .env.example and keeps an existing key", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-key-"));
  await writeFile(join(root, ".env.example"), "APP_ENV=local\nAPP_KEY=\nPORT=3000\n");

  const first = await writeAppKey(root);
  expect(first.written).toBe(true);
  expect(first.key.startsWith("base64:")).toBe(true);
  const env = await readFile(join(root, ".env"), "utf8");
  expect(env).toBe(`APP_ENV=local\nAPP_KEY=${first.key}\nPORT=3000\n`);

  const again = await writeAppKey(root);
  expect(again).toEqual({ key: first.key, written: false });

  const forced = await writeAppKey(root, { force: true });
  expect(forced.written).toBe(true);
  expect(forced.key).not.toBe(first.key);
});

test("writeAppKey appends APP_KEY when the file has none", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-key-"));
  await writeFile(join(root, ".env"), "APP_ENV=local");
  const { key } = await writeAppKey(root);
  expect(await readFile(join(root, ".env"), "utf8")).toBe(`APP_ENV=local\nAPP_KEY=${key}\n`);
});
