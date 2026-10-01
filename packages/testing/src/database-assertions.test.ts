import { expect, test } from "bun:test";
import { connectSqlite, setDefaultConnection, schemaFor } from "@bunyad/database";
import {
  assertDatabaseCount,
  assertDatabaseHas,
  assertDatabaseMissing,
} from "./database-assertions.ts";
import { PendingCommand } from "./pending-command.ts";

test("assertDatabaseHas Missing and Count", async () => {
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await schemaFor(connection).create("widgets", (table) => {
    table.id();
    table.string("name");
  });
  await connection.run("INSERT INTO widgets (name) VALUES (?)", ["alpha"]);

  await assertDatabaseHas("widgets", { name: "alpha" });
  await assertDatabaseMissing("widgets", { name: "missing" });
  await assertDatabaseCount("widgets", 1);
  await assertDatabaseCount("widgets", 1, { name: "alpha" });

  await connection.close();
});

test("PendingCommand asserts exit codes", async () => {
  await new PendingCommand(0, "ok").assertExitCode(0).then((p) =>
    p.assertSuccessful(),
  );
  const failed = new PendingCommand(1, "fail");
  await failed.assertFailed();
  await failed.assertSee("fail");
});

test("TestCase.command runs about command", async () => {
  const { TestCase } = await import("./test-case.ts");
  const case_ = new TestCase();
  const result = case_.command("about", ["--json"]);
  await result.assertSuccessful();
  await result.assertSee("runtime");
});
