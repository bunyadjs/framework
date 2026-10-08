import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, Pivot } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class PmMembership extends Pivot {
  static table = "pm_memberships";
  static casts() { return { active: "boolean" as const, perms: "json" as const }; }
  declare active: boolean;
  declare perms: string[];
  declare role: string;
  label() { return `${this.role}${this.active ? " (active)" : ""}`; }
}
class PmTeam extends Model {
  static table = "pm_teams";
  static fillable = ["name"];
  declare id: number;
  members() {
    return this.belongsToMany(PmUser, "pm_memberships", "team_id", "user_id")
      .using(PmMembership)
      .as("membership")
      .withPivot("role", "active", "perms");
  }
  plain() {
    return this.belongsToMany(PmUser, "pm_memberships", "team_id", "user_id").withPivot("role");
  }
  timestamped() {
    return this.belongsToMany(PmUser, "pm_memberships", "team_id", "user_id").withTimestamps();
  }
}
class PmUser extends Model {
  static table = "pm_users";
  static fillable = ["name"];
  declare id: number;
  declare name: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "custom pivot models: using() and as() (%s)",
  (_name, driver) => {
    const c = driver.connection;
    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      for (const t of ["pm_memberships", "pm_users", "pm_teams"]) await schema.dropIfExists(t);
      await schema.create("pm_teams", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("pm_users", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("pm_memberships", (b) => {
        b.integer("team_id"); b.integer("user_id"); b.string("role").nullable(); b.boolean("active").nullable();
        b.text("perms").nullable(); b.timestamp("created_at").nullable(); b.timestamp("updated_at").nullable();
      });
    });
    beforeEach(async () => {
      for (const t of ["pm_memberships", "pm_users", "pm_teams"]) await c.run(`DELETE FROM ${t}`);
    });
    afterAll(async () => {
      const schema = schemaFor(c);
      for (const t of ["pm_memberships", "pm_users", "pm_teams"]) await schema.dropIfExists(t);
    });
    async function seed() {
      const team = (await PmTeam.create({ name: "T" })) as PmTeam;
      const u1 = (await PmUser.create({ name: "u1" })) as PmUser;
      const u2 = (await PmUser.create({ name: "u2" })) as PmUser;
      return { team, u1, u2 };
    }

    test("as() renames the pivot property", async () => {
      const { team, u1 } = await seed();
      await team.plain().attach(u1.id, { role: "dev" });
      const rel = new PmTeam().members();
      expect(rel.getPivotAccessor()).toBe("membership");
      const u = ((await team.members().get()).first()) as any;
      expect(u.pivot).toBeUndefined();
      expect(u.membership.role).toBe("dev");
    });

    test("using() hydrates the pivot as a model with its casts and methods", async () => {
      const { team, u1 } = await seed();
      await team.members().attach(u1.id, { role: "lead", active: true, perms: ["read", "write"] });
      const u = ((await team.members().get()).first()) as any;
      expect(u.membership).toBeInstanceOf(PmMembership);
      expect(u.membership.active).toBe(true);
      expect(u.membership.perms).toEqual(["read", "write"]);
      expect(u.membership.label()).toBe("lead (active)");
      expect(u.membership.exists).toBe(true);
    });

    test("pivot writes go through the pivot model's set-casts", async () => {
      const { team, u1, u2 } = await seed();
      await team.members().attach({ [u1.id]: { role: "a", active: false, perms: ["x"] }, [u2.id]: { role: "b", active: true, perms: [] } });
      const stored = await c.all<Record<string, unknown>>("SELECT role, perms FROM pm_memberships ORDER BY user_id");
      expect(stored.map((r) => r.perms)).toEqual(['["x"]', "[]"]);
      await team.members().updateExistingPivot(u1.id, { perms: ["y", "z"] });
      expect(((await c.all<Record<string, unknown>>("SELECT perms FROM pm_memberships WHERE user_id = ?", [u1.id]))[0]!).perms).toBe('["y","z"]');
    });

    test("eager loading honors as() and using()", async () => {
      const { team, u1 } = await seed();
      await team.members().attach(u1.id, { role: "eager", active: true, perms: ["p"] });
      const loaded = (await PmTeam.with("members").find(team.id)) as any;
      const u = loaded.members.first();
      expect(u.membership).toBeInstanceOf(PmMembership);
      expect(u.membership.role).toBe("eager");
      expect(u.membership.active).toBe(true);
    });

    test("withTimestamps() also reads created_at / updated_at onto the pivot", async () => {
      const { team, u1 } = await seed();
      await team.timestamped().attach(u1.id);
      const u = ((await team.timestamped().get()).first()) as any;
      expect(u.pivot.created_at).toBeTruthy();
      expect(u.pivot.updated_at).toBeTruthy();
      expect(u.pivot.team_id).toBeDefined();
    });
  },
);
