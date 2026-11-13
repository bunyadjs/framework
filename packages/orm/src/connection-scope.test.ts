import { expect, test } from "bun:test";
import { DB, connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";

class Note extends Model {
  static table = "notes";
  static timestamps = false;
  static fillable = ["body"];
  declare body: string;
}

async function makeDb(name: string) {
  const connection = connectSqlite();
  connection.setName(name);
  await schemaFor(connection).create("notes", (t) => {
    t.id();
    t.string("body");
  });
  return connection;
}

const bodies = async () => (await Note.query().get()).all().map((n) => n.body);

test("models and DB.table use the scoped connection, everything else keeps the default", async () => {
  const live = await makeDb("live");
  const other = await makeDb("other");
  Model.setConnection(live);

  await Note.create({ body: "live-1" });
  await DB.usingConnection(other, async () => {
    await Note.create({ body: "other-1" });
    expect(await bodies()).toEqual(["other-1"]);
    expect(await DB.table("notes").count()).toBe(1);
    expect(Note.getConnection()).toBe(other);
  });

  expect(await bodies()).toEqual(["live-1"]);
  expect(Note.getConnection()).toBe(live);
});

test("concurrent scopes do not see each other", async () => {
  const live = await makeDb("live");
  const a = await makeDb("a");
  const b = await makeDb("b");
  Model.setConnection(live);

  const run = (conn: typeof a, tag: string) =>
    DB.usingConnection(conn, async () => {
      for (let i = 0; i < 5; i++) {
        await Note.create({ body: `${tag}-${i}` });
        await Bun.sleep(1);
      }
      return bodies();
    });

  const [fromA, fromB] = await Promise.all([run(a, "a"), run(b, "b")]);
  expect(fromA.every((x) => x.startsWith("a-"))).toBe(true);
  expect(fromB.every((x) => x.startsWith("b-"))).toBe(true);
  expect(fromA).toHaveLength(5);
  expect(fromB).toHaveLength(5);
  expect(await bodies()).toEqual([]);
});

test("a transaction inside a scope runs on, and rolls back on, the scoped connection", async () => {
  const live = await makeDb("live");
  const other = await makeDb("other");
  Model.setConnection(live);

  await DB.usingConnection(other, async () => {
    await Note.getConnection().transaction(async () => {
      await Note.create({ body: "kept" });
    });
    await Note.getConnection()
      .transaction(async () => {
        await Note.create({ body: "gone" });
        throw new Error("boom");
      })
      .catch(() => undefined);
    expect(await bodies()).toEqual(["kept"]);
  });
  expect(await bodies()).toEqual([]);
});

test("a connection named explicitly still wins over the scope", async () => {
  const live = await makeDb("live");
  const other = await makeDb("other");
  Model.setConnection(live);
  DB.addConnection("explicit", live);

  await Note.create({ body: "live-1" });
  await DB.usingConnection(other, async () => {
    expect((await Note.on("explicit").get()).all().map((n) => n.body)).toEqual([
      "live-1",
    ]);
  });
});

test("a registered connection name works the same as a handle", async () => {
  const live = await makeDb("live");
  const other = await makeDb("other");
  Model.setConnection(live);
  DB.addConnection("other", other);

  const result = await DB.usingConnection("other", async () => {
    await Note.create({ body: "by-name" });
    return bodies();
  });
  expect(result).toEqual(["by-name"]);
  expect(await bodies()).toEqual([]);
});
