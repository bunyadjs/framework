import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "belongsToMany pivot operations (%s)",
  (_name, driver) => {
    class Team extends Model {
      static table = "po_teams";
      static fillable = ["name"];
      declare id: number;
      members() {
        return this.belongsToMany(Member, "po_member_team", "team_id", "member_id").withPivot("role");
      }
      stamped() {
        return this.belongsToMany(Member, "po_member_team_ts", "team_id", "member_id")
          .withPivot("role")
          .withTimestamps();
      }
    }
    class Member extends Model {
      static table = "po_members";
      static fillable = ["name"];
      declare id: number;
    }

    const pivotRows = (table = "po_member_team") =>
      driver.connection.all<Record<string, unknown>>(
        `SELECT * FROM ${table} ORDER BY member_id`,
      );

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of ["po_member_team", "po_member_team_ts", "po_teams", "po_members"]) {
        await schema.dropIfExists(t);
      }
      await schema.create("po_teams", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("po_members", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("po_member_team", (b) => {
        b.integer("team_id");
        b.integer("member_id");
        b.string("role").nullable();
      });
      await schema.create("po_member_team_ts", (b) => {
        b.integer("team_id");
        b.integer("member_id");
        b.string("role").nullable();
        b.timestamp("created_at").nullable();
        b.timestamp("updated_at").nullable();
      });
    });

    beforeEach(async () => {
      await driver.connection.run("DELETE FROM po_member_team");
      await driver.connection.run("DELETE FROM po_member_team_ts");
    });

    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of ["po_member_team", "po_member_team_ts", "po_teams", "po_members"]) {
        await schema.dropIfExists(t);
      }
    });

    async function seed(n = 4) {
      const team = await Team.create({ name: "T" });
      const members: Member[] = [];
      for (let i = 0; i < n; i++) members.push(await Member.create({ name: `m${i}` }));
      return { team, ids: members.map((m) => m.id) };
    }

    test("attach with shared and per-id pivot attributes", async () => {
      const { team, ids } = await seed();
      await team.members().attach([ids[0]!, ids[1]!], { role: "dev" });
      await team.members().attach({ [ids[2]!]: { role: "lead" } });
      const rows = await pivotRows();
      expect(rows.map((r) => r.role)).toEqual(["dev", "dev", "lead"]);
      const loaded = await team.members().get();
      expect(loaded.count()).toBe(3);
    });

    test("attach inserts a large batch in chunks", async () => {
      const { team } = await seed(0);
      const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
      await team.members().attach(ids);
      const [{ c }] = await driver.connection.all<{ c: number }>(
        "SELECT COUNT(*) AS c FROM po_member_team",
      );
      expect(Number(c)).toBe(2500);
    });

    test("updateExistingPivot returns affected rows", async () => {
      const { team, ids } = await seed();
      await team.members().attach(ids.slice(0, 2), { role: "dev" });
      expect(await team.members().updateExistingPivot(ids[0]!, { role: "lead" })).toBe(1);
      expect(await team.members().updateExistingPivot(ids[3]!, { role: "x" })).toBe(0);
      expect((await pivotRows()).map((r) => r.role)).toEqual(["lead", "dev"]);
    });

    test("sync diffs and reports attached / detached / updated", async () => {
      const { team, ids } = await seed();
      await team.members().attach(ids.slice(0, 3), { role: "dev" });
      const res = await team.members().sync({
        [ids[1]!]: { role: "lead" },
        [ids[3]!]: { role: "new" },
      });
      expect(res.attached.map(String)).toEqual([String(ids[3])]);
      expect(res.detached.map(String).sort()).toEqual([String(ids[0]), String(ids[2])].sort());
      expect(res.updated.map(String)).toEqual([String(ids[1])]);
      const rows = await pivotRows();
      expect(rows.map((r) => [Number(r.member_id), r.role])).toEqual([
        [ids[1], "lead"],
        [ids[3], "new"],
      ]);
    });

    test("sync keeps untouched pivot data (no delete + reinsert)", async () => {
      const { team, ids } = await seed();
      await team.members().attach(ids.slice(0, 2), { role: "keep" });
      await team.members().sync([ids[0]!, ids[1]!, ids[2]!]);
      const rows = await pivotRows();
      expect(rows.map((r) => r.role)).toEqual(["keep", "keep", null]);
    });

    test("syncWithoutDetaching never removes", async () => {
      const { team, ids } = await seed();
      await team.members().attach([ids[0]!]);
      const res = await team.members().syncWithoutDetaching([ids[1]!, ids[0]!]);
      expect(res.detached).toEqual([]);
      expect(res.attached.map(String)).toEqual([String(ids[1])]);
      expect((await pivotRows()).length).toBe(2);
    });

    test("toggle returns attached and detached", async () => {
      const { team, ids } = await seed();
      await team.members().attach([ids[0]!]);
      const res = await team.members().toggle([ids[0]!, ids[1]!]);
      expect(res.detached.map(String)).toEqual([String(ids[0])]);
      expect(res.attached.map(String)).toEqual([String(ids[1])]);
    });

    test("detach returns deleted count and accepts models", async () => {
      const { team, ids } = await seed();
      await team.members().attach(ids);
      expect(await team.members().detach([ids[0]!, ids[1]!])).toBe(2);
      const m = await Member.find(ids[2]!);
      expect(await team.members().detach(m as Member)).toBe(1);
      expect(await team.members().detach()).toBe(1);
    });

    test("withTimestamps stamps created_at and updated_at", async () => {
      const { team, ids } = await seed();
      await team.stamped().attach(ids[0]!, { role: "dev" });
      let [row] = await pivotRows("po_member_team_ts");
      expect(row!.created_at).toBeTruthy();
      expect(row!.updated_at).toBeTruthy();
      const created = row!.created_at;
      await team.stamped().updateExistingPivot(ids[0]!, { role: "lead" });
      [row] = await pivotRows("po_member_team_ts");
      expect(row!.role).toBe("lead");
      expect(row!.created_at).toEqual(created);
    });

    test("does not touch another parent's pivot rows", async () => {
      const { team, ids } = await seed();
      const other = await Team.create({ name: "O" });
      await other.members().attach(ids.slice(0, 2));
      await team.members().attach(ids.slice(0, 2));
      await team.members().sync([]);
      expect((await other.members().get()).count()).toBe(2);
    });
  },
);
