import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectSqlite } from "./drivers/bun/sqlite.ts";

test(`a SQLite transaction holds the write lock from its first statement`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunyad-sqlite-lock-"));
  const path = join(dir, "lock.db");
  const first = connectSqlite({ path });
  const second = connectSqlite({ path });
  try {
    await first.get("PRAGMA journal_mode = WAL");
    await second.get("PRAGMA busy_timeout = 0");
    await first.run("CREATE TABLE locks (id INTEGER PRIMARY KEY)");

    await first.transaction(async () => {
      // Only a read so far. A deferred transaction would not block the other connection yet, and
      // would later fail its own first write once that connection committed.
      await first.get("SELECT COUNT(*) AS n FROM locks");
      expect(() => second.runSync("INSERT INTO locks (id) VALUES (1)")).toThrow(/locked/);
    });

    second.runSync("INSERT INTO locks (id) VALUES (1)");
  } finally {
    first.raw.close();
    second.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
