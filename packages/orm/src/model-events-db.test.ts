import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { resetModelEventsForTests } from "../src/model-events.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.each(drivers.map((d) => [d.name, d] as const))(
  "model events on a real database (%s)",
  (_name, driver) => {
    class Doc extends Model {
      static table = "ev_docs";
      static fillable = ["title"];
      static softDeletes = true;
      declare id: number;
      declare title: string;
    }
    let log: string[] = [];
    const record = (model: typeof Doc, events: string[]) => {
      for (const e of events) {
        (model as unknown as Record<string, (cb: () => unknown) => void>)[e]!(() => { log.push(e); });
      }
    };
    const allEvents = ["saving", "creating", "created", "updating", "updated", "saved", "deleting", "deleted", "trashed", "restoring", "restored", "forceDeleting", "forceDeleted"];

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      await schema.dropIfExists("ev_docs");
      await schema.create("ev_docs", (b) => { b.id(); b.string("title"); b.timestamps(); b.softDeletes(); });
    });
    beforeEach(() => {
      resetModelEventsForTests(Doc);
      log = [];
      record(Doc, allEvents);
    });
    afterAll(async () => {
      await schemaFor(driver.connection).dropIfExists("ev_docs");
    });

    test("create order", async () => {
      await Doc.create({ title: "a" });
      expect(log).toEqual(["saving", "creating", "created", "saved"]);
    });

    test("update order, and updated only fires when dirty", async () => {
      const d = await Doc.create({ title: "a" });
      log.length = 0;
      d.title = "b";
      await d.save();
      expect(log).toEqual(["saving", "updating", "updated", "saved"]);
      log.length = 0;
      await d.save();
      expect(log).toEqual(["saving", "updating", "saved"]);
    });

    test("soft delete, restore and force delete order", async () => {
      const d = await Doc.create({ title: "a" });
      log.length = 0;
      await d.delete();
      expect(log).toEqual(["deleting", "trashed", "deleted"]);
      log.length = 0;
      await d.restore();
      expect(log).toEqual(["restoring", "restored"]);
      log.length = 0;
      await d.forceDelete();
      expect(log).toEqual(["forceDeleting", "deleting", "deleted", "forceDeleted"]);
    });

    test("returning false from a before-event cancels the write", async () => {
      resetModelEventsForTests(Doc);
      Doc.creating(() => false);
      const d = new Doc({ title: "blocked" });
      await d.save();
      expect(d.exists).toBe(false);
      expect(await Doc.where("title", "blocked").count()).toBe(0);
    });

    test("a listener can change attributes before they are written (creating / updating)", async () => {
      resetModelEventsForTests(Doc);
      Doc.creating((m) => { (m as Doc).title = (m as Doc).title.toUpperCase(); });
      const d = await Doc.create({ title: "shout" });
      expect((await Doc.find(d.id))!.title).toBe("SHOUT");
    });

    test("timestamps are set after creating, so listeners see an unstamped model", async () => {
      resetModelEventsForTests(Doc);
      let seen: unknown = "unset";
      Doc.creating((m) => { seen = (m as unknown as Record<string, unknown>).created_at; });
      await Doc.create({ title: "ts" });
      expect(seen).toBeUndefined();
    });

    test("observers: afterCommit waits for the outermost commit", async () => {
      resetModelEventsForTests(Doc);
      const seen: string[] = [];
      Doc.observe({
        afterCommit: true,
        created: (m) => { seen.push(`created:${(m as Doc).title}`); },
        creating: () => { seen.push("creating"); },
      });
      await driver.connection.transaction(async () => {
        await Doc.create({ title: "tx" });
        seen.push("inside");
      });
      await sleep(20);
      expect(seen).toEqual(["creating", "inside", "created:tx"]);
    });

    test("observers: afterCommit events are dropped on rollback", async () => {
      resetModelEventsForTests(Doc);
      const seen: string[] = [];
      Doc.observe({ afterCommit: true, created: () => { seen.push("created"); } });
      await expect(
        driver.connection.transaction(async () => {
          await Doc.create({ title: "rollback" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      await sleep(20);
      expect(seen).toEqual([]);
      expect(await Doc.where("title", "rollback").count()).toBe(0);
    });

    test("observers: afterCommit outside a transaction runs right away", async () => {
      resetModelEventsForTests(Doc);
      const seen: string[] = [];
      Doc.observe({ afterCommit: true, created: () => { seen.push("created"); } });
      await Doc.create({ title: "plain" });
      await sleep(20);
      expect(seen).toEqual(["created"]);
    });

    test("saveQuietly / deleteQuietly fire nothing", async () => {
      const d = new Doc({ title: "q" });
      await d.saveQuietly();
      d.title = "q2";
      await d.saveQuietly();
      await d.deleteQuietly();
      expect(log).toEqual([]);
    });
  },
);
