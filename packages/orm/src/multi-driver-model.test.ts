import { expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers } from "./test-drivers.ts";

// One model class used against every available database in the same process
// (compiled-SQL caches must not leak identifier quoting between dialects).
class Shared extends Model {
  declare n: number;
  static table = "md_shared";
  static fillable = ["body", "n"];
  static softDeletes = true;
  declare id: number;
  declare body: string;
}

const drivers = await testDrivers();

test("one model class works across all drivers, in any order", async () => {
  expect(drivers.length).toBeGreaterThan(0);
  for (const round of [1, 2]) {
    for (const d of drivers) {
      Model.setConnection(d.connection);
      const schema = schemaFor(d.connection);
      if (round === 1) {
        await schema.dropIfExists("md_shared");
        await schema.create("md_shared", (b) => {
          b.id();
          b.string("body");
          b.integer("n").nullable();
          b.timestamps();
          b.softDeletes();
        });
      }
      const row = await Shared.create({ body: `r${round}-${d.name}`, n: round });
      const found = await Shared.where("body", `r${round}-${d.name}`).first();
      expect(found?.id, `${d.name} first() round ${round}`).toBe(row.id);
      expect((await Shared.where("n", round).get()).count(), `${d.name} get() round ${round}`).toBeGreaterThan(0);
      expect(await Shared.find(row.id), `${d.name} find()`).not.toBeNull();
      expect(await Shared.where("body", "like", `r${round}%`).count()).toBeGreaterThan(0);
    }
  }
  for (const d of drivers) {
    await schemaFor(d.connection).dropIfExists("md_shared");
  }
});
