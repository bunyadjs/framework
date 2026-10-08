import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { resetModelEventsForTests } from "../src/model-events.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class SgTeam extends Model {
  static table = "sg_teams";
  static fillable = ["name"];
  static softDeletes = true;
  declare id: number;
  declare name: string;
  members() { return this.hasMany(SgMember, "team_id").chaperone(); }
  lead() { return this.hasOne(SgMember, "team_id").chaperone("team"); }
  plainMembers() { return this.hasMany(SgMember, "team_id"); }
  projects() { return this.hasMany(SgProject, "team_id"); }
}
class SgMember extends Model {
  static table = "sg_members";
  static fillable = ["team_id", "name"];
  declare id: number;
  declare name: string;
}
class SgProject extends Model {
  declare team_id: number;
  static table = "sg_projects";
  static fillable = ["team_id", "name", "active"];
  static softDeletes = true;
  declare id: number;
  tasks() { return this.hasMany(SgTask, "project_id"); }
}
class SgTask extends Model {
  static table = "sg_tasks";
  static fillable = ["project_id", "title", "done"];
  declare id: number;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "assorted ORM behaviors (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const tables = ["sg_tasks", "sg_projects", "sg_members", "sg_teams"];
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("sg_teams", (b) => { b.id(); b.string("name"); b.timestamps(); b.softDeletes(); });
      await schema.create("sg_members", (b) => { b.id(); b.integer("team_id"); b.string("name"); b.timestamps(); });
      await schema.create("sg_projects", (b) => { b.id(); b.integer("team_id"); b.string("name"); b.integer("active"); b.timestamps(); b.softDeletes(); });
      await schema.create("sg_tasks", (b) => { b.id(); b.integer("project_id"); b.string("title"); b.integer("done"); b.timestamps(); });
      const team = (await SgTeam.create({ name: "T" })) as SgTeam;
      await SgMember.create({ team_id: team.id, name: "m1" });
      await SgMember.create({ team_id: team.id, name: "m2" });
      for (const [n, active] of [["p1", 1], ["p2", 0]] as const) {
        const p = (await SgProject.create({ team_id: team.id, name: n, active })) as SgProject;
        for (const [t, done] of [["a", 1], ["b", 0], ["c", 0]] as const) await SgTask.create({ project_id: p.id, title: `${n}-${t}`, done });
      }
    });
    afterAll(async () => {
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("Model.withoutEvents() mutes every model, and restores events afterwards", async () => {
      resetModelEventsForTests(SgMember);
      resetModelEventsForTests(SgTeam);
      const seen: string[] = [];
      SgMember.created(() => { seen.push("member"); });
      SgTeam.created(() => { seen.push("team"); });
      await Model.withoutEvents(async () => {
        await SgMember.create({ team_id: 1, name: "quiet" });
        await SgTeam.create({ name: "quiet team" });
      });
      expect(seen).toEqual([]);
      await SgMember.create({ team_id: 1, name: "loud" });
      expect(seen).toEqual(["member"]);
      // a subclass call mutes only that model
      await SgMember.withoutEvents(async () => { await SgTeam.create({ name: "still loud" }); });
      expect(seen).toEqual(["member", "team"]);
      resetModelEventsForTests(SgMember);
      resetModelEventsForTests(SgTeam);
    });

    test("chaperone(): children point back at the parent (eager and lazy), without a query or a JSON cycle", async () => {
      const team = (await SgTeam.with("members", "lead").where("name", "T").first()) as any;
      expect(team.members.count()).toBeGreaterThan(1);
      for (const m of team.members.all()) expect(m.sgTeam ?? m.team ?? m.SgTeam).toBeDefined();
      expect(team.lead.team).toBe(team);
      const lazy = ((await team.related("members").get()).first()) as any;
      expect(lazy.sgTeam).toBe(team);
      expect(team.members.first().sgTeam).toBe(team);
      // the back-reference is not an attribute and does not serialize
      const json = JSON.parse(JSON.stringify(team));
      expect(json.members[0].sgTeam).toBeUndefined();
      expect(Object.keys(team.members.first().getAttributes())).not.toContain("sgTeam");
      // without chaperone() nothing is set
      const plain = ((await team.related("plainMembers").get()).first()) as any;
      expect(plain.sgTeam).toBeUndefined();
    });

    test("nested eager loads accept a constraint at each level", async () => {
      const team = (await SgTeam.with({
        projects: (q: any) => q.where("active", 1),
        "projects.tasks": (q: any) => q.where("done", 0).orderBy("title"),
      }).where("name", "T").first()) as any;
      expect(team.projects.count()).toBe(1);
      expect(team.projects.first().tasks.pluck("title").all()).toEqual(["p1-b", "p1-c"]);
    });

    test("an anonymous (closure) global scope applies to every query and can be removed", async () => {
      class SgScoped extends Model {
        static table = "sg_projects";
        static fillable = ["name"];
        static softDeletes = true;
      }
      SgScoped.addGlobalScope((q) => q.where("active", 1));
      expect((await SgScoped.get()).count()).toBe(1);
      expect((await SgScoped.withoutGlobalScopes().get()).count()).toBeGreaterThan(1);
    });

    test("transaction(callback, attempts) retries on a deadlock-like error and then succeeds", async () => {
      let runs = 0;
      const result = await c.transaction(async () => {
        runs++;
        if (runs < 3) throw new Error("deadlock detected");
        await SgMember.create({ team_id: 1, name: "after retries" });
        return "ok";
      }, 3);
      expect(result).toBe("ok");
      expect(runs).toBe(3);
      expect(await SgMember.where("name", "after retries").count()).toBe(1);
    });

    test("transaction attempts do not retry ordinary errors, and give up after the last attempt", async () => {
      let runs = 0;
      await expect(c.transaction(async () => { runs++; throw new Error("not retryable"); }, 3)).rejects.toThrow("not retryable");
      expect(runs).toBe(1);
      let deadlocks = 0;
      await expect(c.transaction(async () => { deadlocks++; throw new Error("deadlock detected"); }, 2)).rejects.toThrow("deadlock");
      expect(deadlocks).toBe(2);
    });

    test("after a rollback the database is restored but the in-memory model is not", async () => {
      const m = new SgMember({ team_id: 1, name: "rolled back" });
      await expect(
        c.transaction(async () => {
          await m.save();
          throw new Error("abort");
        }),
      ).rejects.toThrow("abort");
      expect(await SgMember.where("name", "rolled back").count()).toBe(0);
      // Same as Laravel: the instance still believes it was saved.
      expect(m.exists).toBe(true);
      expect(m.id).toBeDefined();
    });

    test("cascading soft deletes with a deleting listener", async () => {
      resetModelEventsForTests(SgTeam);
      SgTeam.deleting(async (team) => {
        const projects = await (team as SgTeam).projects().get();
        for (const p of projects.all()) await (p as SgProject).delete();
      });
      const team = (await SgTeam.create({ name: "cascade" })) as SgTeam;
      await SgProject.create({ team_id: team.id, name: "c1", active: 1 });
      await SgProject.create({ team_id: team.id, name: "c2", active: 1 });
      await team.delete();
      expect(await SgProject.where("team_id", team.id).count()).toBe(0);
      expect(await SgProject.withTrashed().where("team_id", team.id).count()).toBe(2);
      await team.restore();
      expect(await SgTeam.where("id", team.id).count()).toBe(1); // restoring the parent does not restore children
      expect(await SgProject.where("team_id", team.id).count()).toBe(0);
      resetModelEventsForTests(SgTeam);
    });
  },
);
