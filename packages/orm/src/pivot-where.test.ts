import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class PwProject extends Model {
  static table = "pw_projects";
  static fillable = ["name"];
  declare id: number;
  declare name: string;
  // Two relations over ONE pivot table, split by the pivot's `role`.
  leads() { return this.belongsToMany(PwUser, "pw_project_user", "project_id", "user_id").wherePivot("role", "lead").withPivot("role", "rank"); }
  members() { return this.belongsToMany(PwUser, "pw_project_user", "project_id", "user_id").wherePivot("role", "member").withPivot("role", "rank"); }
  ranked() { return this.belongsToMany(PwUser, "pw_project_user", "project_id", "user_id").withPivot("role", "rank").orderByPivot("rank", "desc"); }
  senior() { return this.belongsToMany(PwUser, "pw_project_user", "project_id", "user_id").wherePivotBetween("rank", [5, 9]); }
  unranked() { return this.belongsToMany(PwUser, "pw_project_user", "project_id", "user_id").wherePivotNull("rank"); }
  notMembers() { return this.belongsToMany(PwUser, "pw_project_user", "project_id", "user_id").wherePivotNotIn("role", ["member"]); }
}
class PwUser extends Model {
  static table = "pw_users";
  static fillable = ["name"];
  declare id: number;
  declare name: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "wherePivot / orderByPivot (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const num = (v: unknown) => Number(v);
    const pivot = () => c.all<Record<string, unknown>>("SELECT * FROM pw_project_user ORDER BY project_id, user_id");

    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      for (const t of ["pw_project_user", "pw_users", "pw_projects"]) await schema.dropIfExists(t);
      await schema.create("pw_projects", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("pw_users", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("pw_project_user", (b) => {
        b.integer("project_id"); b.integer("user_id"); b.string("role"); b.integer("rank").nullable();
      });
    });
    beforeEach(async () => {
      for (const t of ["pw_project_user", "pw_projects", "pw_users"]) await c.run(`DELETE FROM ${t}`);
    });
    afterAll(async () => {
      const schema = schemaFor(c);
      for (const t of ["pw_project_user", "pw_users", "pw_projects"]) await schema.dropIfExists(t);
    });

    async function seed() {
      const p = (await PwProject.create({ name: "P" })) as PwProject;
      const users: PwUser[] = [];
      for (const n of ["u1", "u2", "u3", "u4"]) users.push((await PwUser.create({ name: n })) as PwUser);
      return { p, ids: users.map((u) => u.id) };
    }

    test("attach through a wherePivot('=') relation fills the pivot default", async () => {
      const { p, ids } = await seed();
      await p.leads().attach([ids[0]!, ids[1]!]);
      await p.members().attach([ids[2]!]);
      expect((await pivot()).map((r) => r.role)).toEqual(["lead", "lead", "member"]);
    });

    test("get() returns only rows matching the pivot constraint", async () => {
      const { p, ids } = await seed();
      await p.leads().attach([ids[0]!, ids[1]!]);
      await p.members().attach([ids[2]!, ids[3]!]);
      expect((await p.leads().get()).pluck("name").all().sort()).toEqual(["u1", "u2"]);
      expect((await p.members().get()).pluck("name").all().sort()).toEqual(["u3", "u4"]);
    });

    test("sync / detach on one relation never touch the other relation's rows", async () => {
      const { p, ids } = await seed();
      await p.leads().attach([ids[0]!, ids[1]!]);
      await p.members().attach([ids[2]!, ids[3]!]);
      const res = await p.leads().sync([ids[1]!, ids[3]!]);
      expect(res.attached.map(Number)).toEqual([ids[3]!]);
      expect(res.detached.map(Number)).toEqual([ids[0]!]);
      expect((await p.members().get()).count()).toBe(2); // untouched
      expect(await p.leads().detach()).toBe(2);
      expect((await pivot()).filter((r) => r.role === "member")).toHaveLength(2);
    });

    test("updateExistingPivot respects the constraint", async () => {
      const { p, ids } = await seed();
      await p.leads().attach([ids[0]!]);
      await p.members().attach([ids[1]!]);
      expect(await p.leads().updateExistingPivot(ids[1]!, { rank: 1 })).toBe(0); // user 2 is a member, not a lead
      expect(await p.leads().updateExistingPivot(ids[0]!, { rank: 1 })).toBe(1);
    });

    test("orderByPivot orders related rows by a pivot column", async () => {
      const { p, ids } = await seed();
      await p.ranked().attach({ [ids[0]!]: { role: "member", rank: 2 }, [ids[1]!]: { role: "member", rank: 9 }, [ids[2]!]: { role: "member", rank: 5 } });
      expect((await p.ranked().get()).pluck("name").all()).toEqual(["u2", "u3", "u1"]);
    });

    test("wherePivotBetween / Null / NotIn", async () => {
      const { p, ids } = await seed();
      await p.ranked().attach({ [ids[0]!]: { role: "lead", rank: 2 }, [ids[1]!]: { role: "member", rank: 7 }, [ids[2]!]: { role: "member" }, [ids[3]!]: { role: "lead", rank: 5 } });
      expect((await p.senior().get()).pluck("name").all().sort()).toEqual(["u2", "u4"]);
      expect((await p.unranked().get()).pluck("name").all()).toEqual(["u3"]);
      expect((await p.notMembers().get()).pluck("name").all().sort()).toEqual(["u1", "u4"]);
    });

    test("eager loading honors the pivot constraint and order", async () => {
      const { p, ids } = await seed();
      await p.leads().attach({ [ids[0]!]: { rank: 1 }, [ids[1]!]: { rank: 3 } });
      await p.members().attach({ [ids[2]!]: { rank: 2 } });
      const loaded = (await PwProject.with("leads", "members").find(p.id)) as any;
      expect(loaded.leads.pluck("name").all().sort()).toEqual(["u1", "u2"]);
      expect(loaded.members.pluck("name").all()).toEqual(["u3"]);
      expect(loaded.leads.first().pivot.role).toBe("lead");
    });

    test("whereHas, withCount and withSum use the pivot constraint", async () => {
      const { p, ids } = await seed();
      const q = (await PwProject.create({ name: "Q" })) as PwProject;
      await p.leads().attach([ids[0]!, ids[1]!]);
      await q.members().attach([ids[2]!]);
      expect((await PwProject.whereHas("leads").get()).pluck("name").all()).toEqual(["P"]);
      expect((await PwProject.whereHas("members").get()).pluck("name").all()).toEqual(["Q"]);
      const rows = await PwProject.withCount("leads", "members").orderBy("name").get();
      const [a, b] = rows.all() as any[];
      expect([num(a.leads_count), num(a.members_count)]).toEqual([2, 0]);
      expect([num(b.leads_count), num(b.members_count)]).toEqual([0, 1]);
    });
  },
);
