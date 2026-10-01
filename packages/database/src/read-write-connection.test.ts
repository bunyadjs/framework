import { expect, test, afterEach } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connect,
  connectSqlite,
  createReadWriteConnection,
  clearReadWriteStickyForTests,
  isReadWriteSticky,
  schemaFor,
} from "./index.ts";

afterEach(() => {
  clearReadWriteStickyForTests();
});

test("read/write proxy routes writes to write and reads to read", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-rw-"));
  const writePath = join(root, "write.sqlite");
  const readPath = join(root, "read.sqlite");
  const write = connectSqlite({ path: writePath });
  const read = connectSqlite({ path: readPath });

  await schemaFor(write).create("items", (t) => {
    t.id();
    t.string("name");
  });
  await schemaFor(read).create("items", (t) => {
    t.id();
    t.string("name");
  });

  const conn = createReadWriteConnection(write, read, { sticky: false });
  await conn.run("INSERT INTO items (name) VALUES (?)", ["only-write"]);

  expect(await write.get<{ name: string }>("SELECT name FROM items")).toEqual({
    name: "only-write",
  });
  expect(await read.get("SELECT name FROM items")).toBeNull();
  expect(await conn.get("SELECT name FROM items")).toBeNull();

  await read.run("INSERT INTO items (name) VALUES (?)", ["only-read"]);
  expect(await conn.get<{ name: string }>("SELECT name FROM items")).toEqual({
    name: "only-read",
  });

  await conn.close();
});

test("sticky read/write uses write connection after a write", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-sticky-"));
  const write = connectSqlite({ path: join(root, "write.sqlite") });
  const read = connectSqlite({ path: join(root, "read.sqlite") });
  await schemaFor(write).create("items", (t) => {
    t.id();
    t.string("name");
  });
  await schemaFor(read).create("items", (t) => {
    t.id();
    t.string("name");
  });

  const conn = createReadWriteConnection(write, read, { sticky: true });
  expect(isReadWriteSticky(write)).toBe(false);
  await conn.run("INSERT INTO items (name) VALUES (?)", ["sticky"]);
  expect(isReadWriteSticky(write)).toBe(true);
  expect(await conn.get<{ name: string }>("SELECT name FROM items")).toEqual({
    name: "sticky",
  });

  await conn.close();
});

test("connect() accepts read/write host config", async () => {
  const root = await mkdtemp(join(tmpdir(), "bunyad-connect-rw-"));
  const conn = connect({
    driver: "sqlite",
    path: join(root, "primary.sqlite"),
    write: { path: join(root, "w.sqlite") },
    read: { path: join(root, "r.sqlite") },
    sticky: true,
  });

  await schemaFor(conn).create("items", (t) => {
    t.id();
    t.string("name");
  });
  await conn.run("INSERT INTO items (name) VALUES (?)", ["via-connect"]);
  expect(await conn.get<{ name: string }>("SELECT name FROM items")).toEqual({
    name: "via-connect",
  });
  await conn.close();
});
