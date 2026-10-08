import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model, Pivot, resetModelEventsForTests } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class PeMembership extends Pivot {
  static table = "pe_memberships";
  declare role: string | null;
}
class PeTeam extends Model {
  static table = "pe_teams";
  static fillable = ["name"];
  declare id: number;
  members() {
    return this.belongsToMany(PeUser, "pe_memberships", "team_id", "user_id")
      .using(PeMembership)
      .withPivot("role");
  }
}
class PeUser extends Model {
  static table = "pe_users";
  static fillable = ["name"];
  declare id: number;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "pivot model events (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const tables = ["pe_memberships", "pe_users", "pe_teams"];
    let team: PeTeam;
    let users: PeUser[];
    let log: string[];

    beforeAll(async () => {
      Model.setConnection(c);
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("pe_teams", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("pe_users", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("pe_memberships", (b) => {
        b.integer("team_id"); b.integer("user_id"); b.string("role").nullable();
      });
    });
    beforeEach(async () => {
      for (const t of tables) await c.run(`DELETE FROM ${t}`);
      resetModelEventsForTests(PeMembership);
      team = await PeTeam.create({ name: "T" });
      users = [await PeUser.create({ name: "a" }), await PeUser.create({ name: "b" })];
      log = [];
    });
    afterAll(async () => {
      resetModelEventsForTests(PeMembership);
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
    });

    const listen = () => {
      for (const ev of ["saving", "creating", "created", "saved", "updating", "updated", "deleting", "deleted"] as const) {
        (PeMembership as any)[ev]((m: any) => { log.push(`${ev}:${m.user_id}`); });
      }
    };
    const rows = () => c.all<Record<string, unknown>>("SELECT * FROM pe_memberships ORDER BY user_id");

    test("no listeners: writes behave as before", async () => {
      await team.members().attach([users[0]!.id]);
      expect((await rows()).length).toBe(1);
      expect(await team.members().detach()).toBe(1);
    });

    test("attach fires saving, creating, created, saved per row", async () => {
      listen();
      await team.members().attach(users.map((u) => u.id));
      const [a, b] = users.map((u) => u.id);
      expect(log).toEqual([`saving:${a}`, `creating:${a}`, `saving:${b}`, `creating:${b}`, `created:${a}`, `saved:${a}`, `created:${b}`, `saved:${b}`]);
      expect((await rows()).length).toBe(2);
    });

    test("creating can change a row or cancel it", async () => {
      (PeMembership as any).creating((m: any) => {
        if (m.user_id === users[1]!.id) return false;
        m.role = "admin";
      });
      await team.members().attach(users.map((u) => u.id));
      const got = await rows();
      expect(got.length).toBe(1);
      expect(got[0]!.role).toBe("admin");
    });

    test("updateExistingPivot fires updating, updated, saved only when changed", async () => {
      await team.members().attach([users[0]!.id], { role: "x" });
      listen();
      expect(await team.members().updateExistingPivot(users[0]!.id, { role: "y" })).toBe(1);
      const a = users[0]!.id;
      expect(log).toEqual([`saving:${a}`, `updating:${a}`, `updated:${a}`, `saved:${a}`]);
      expect((await rows())[0]!.role).toBe("y");
    });

    test("detach fires deleting and deleted; deleting false keeps the row", async () => {
      await team.members().attach(users.map((u) => u.id));
      listen();
      (PeMembership as any).deleting((m: any) => (m.user_id === users[1]!.id ? false : undefined));
      expect(await team.members().detach()).toBe(1);
      const a = users[0]!.id;
      expect(log.filter((l) => l.startsWith("deleted"))).toEqual([`deleted:${a}`]);
      expect((await rows()).map((r) => Number(r.user_id))).toEqual([users[1]!.id]);
    });

    test("sync fires attach and detach events", async () => {
      await team.members().attach([users[0]!.id]);
      listen();
      await team.members().sync([users[1]!.id]);
      const [a, b] = users.map((u) => u.id);
      expect(log).toContain(`deleted:${a}`);
      expect(log).toContain(`created:${b}`);
      expect((await rows()).map((r) => Number(r.user_id))).toEqual([b!]);
    });
  },
);
