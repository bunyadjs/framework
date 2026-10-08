import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Factory, Model, clearMorphMap, morphMap } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "factories on a real database (%s)",
  (_name, driver) => {
    class Team extends Model {
      static table = "fx_teams";
      static fillable = ["name"];
      declare id: number;
      members() { return this.hasMany(Member, "team_id"); }
      comments() { return this.morphMany(Note, "noteable"); }
      skills() { return this.belongsToMany(Skill, "fx_skill_team", "team_id", "skill_id").withPivot("level"); }
    }
    class Member extends Model {
      static table = "fx_members";
      static fillable = ["name", "team_id"];
      declare id: number;
      declare team_id: number;
      declare name: string;
    }
    class Note extends Model {
      static table = "fx_notes";
      static fillable = ["body", "noteable_type", "noteable_id"];
      declare noteable_type: string;
      declare noteable_id: number;
    }
    class Skill extends Model {
      static table = "fx_skills";
      static fillable = ["name"];
      declare id: number;
    }
    let seq = 0;
    class TeamFactory extends Factory<Team> {
      model() { return Team; }
      definition() { return { name: `team ${++seq}` }; }
    }
    class MemberFactory extends Factory<Member> {
      model() { return Member; }
      definition() { return { name: `member ${++seq}` }; }
    }
    class NoteFactory extends Factory<Note> {
      model() { return Note; }
      definition() { return { body: "n" }; }
    }
    class SkillFactory extends Factory<Skill> {
      model() { return Skill; }
      definition() { return { name: `skill ${++seq}` }; }
    }
    const tables = ["fx_skill_team", "fx_skills", "fx_notes", "fx_members", "fx_teams"];
    const count = async (t: string) =>
      Number((await driver.connection.all<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`))[0]!.c);

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      morphMap({ team: Team });
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("fx_teams", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("fx_members", (b) => { b.id(); b.integer("team_id").nullable(); b.string("name"); b.timestamps(); });
      await schema.create("fx_notes", (b) => {
        b.id();
        b.string("body");
        b.string("noteable_type").nullable();
        b.integer("noteable_id").nullable();
        b.timestamps();
      });
      await schema.create("fx_skills", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("fx_skill_team", (b) => { b.integer("team_id"); b.integer("skill_id"); b.string("level").nullable(); });
    });
    beforeEach(async () => {
      for (const t of tables) await driver.connection.run(`DELETE FROM ${t}`);
    });
    afterAll(async () => {
      clearMorphMap();
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("for(Factory) creates the parent once for the whole batch", async () => {
      const members = await MemberFactory.new().for(TeamFactory.new()).count(5).create();
      expect(await count("fx_teams")).toBe(1);
      expect(new Set(members.map((m) => m.team_id)).size).toBe(1);
    });

    test("for(model) reuses an existing parent", async () => {
      const team = await TeamFactory.new().create();
      const members = await MemberFactory.new().for(team).count(3).create();
      expect(members.every((m) => m.team_id === team.id)).toBe(true);
      expect(await count("fx_teams")).toBe(1);
    });

    test("afterMaking runs before the row exists; afterCreating after", async () => {
      const log: string[] = [];
      await MemberFactory.new()
        .afterMaking((m) => { log.push(`making exists=${m.exists}`); })
        .afterCreating((m) => { log.push(`created exists=${m.exists}`); })
        .create();
      expect(log).toEqual(["making exists=false", "created exists=true"]);
    });

    test("has() with hasMany sets the foreign key", async () => {
      const team = await TeamFactory.new().has(MemberFactory.new().count(3)).create();
      const rows = await driver.connection.all<{ team_id: number }>("SELECT team_id FROM fx_members");
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => Number(r.team_id) === team.id)).toBe(true);
    });

    test("has() with morphMany sets both type and id", async () => {
      const team = await TeamFactory.new().has(NoteFactory.new().count(2), "comments").create();
      const rows = await driver.connection.all<Record<string, unknown>>("SELECT * FROM fx_notes");
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.noteable_type === "team" && Number(r.noteable_id) === team.id)).toBe(true);
    });

    test("hasAttached writes pivot attributes (object form)", async () => {
      await TeamFactory.new().hasAttached(SkillFactory.new().count(3), { level: "senior" }).create();
      const rows = await driver.connection.all<{ level: string }>("SELECT level FROM fx_skill_team");
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.level === "senior")).toBe(true);
    });

    test("hasAttached writes per-model pivot attributes (callback form)", async () => {
      await TeamFactory.new()
        .hasAttached(SkillFactory.new().count(2), (skill) => ({ level: `lvl-${(skill as Skill).id}` }))
        .create();
      const rows = await driver.connection.all<{ level: string; skill_id: number }>(
        "SELECT level, skill_id FROM fx_skill_team ORDER BY skill_id",
      );
      expect(rows.map((r) => r.level)).toEqual(rows.map((r) => `lvl-${r.skill_id}`));
    });

    test("recycle reuses given parents instead of creating new ones", async () => {
      const teams = (await TeamFactory.new().count(2).create()) as Team[];
      const teamCount = await count("fx_teams");
      const members = await MemberFactory.new().recycle(teams).for(TeamFactory.new()).count(6).create();
      expect(await count("fx_teams")).toBe(teamCount); // no new team was created
      expect(members.every((m) => teams.some((t) => t.id === m.team_id))).toBe(true);
    });

    test("recycle reaches nested has() factories", async () => {
      const team = await TeamFactory.new().create();
      await TeamFactory.new()
        .recycle(team)
        .has(MemberFactory.new().for(TeamFactory.new()).count(3))
        .create();
      // the three members were attached to a recycled team, not to fresh ones
      const rows = await driver.connection.all<{ team_id: number }>("SELECT team_id FROM fx_members");
      expect(rows).toHaveLength(3);
      expect(await count("fx_teams")).toBe(2); // the recycled team + the outer team
    });

    test("createMany: count and attribute lists", async () => {
      expect(await MemberFactory.new().createMany(4)).toHaveLength(4);
      const named = await MemberFactory.new().createMany([{ name: "a" }, { name: "b" }]);
      expect(named.map((m) => m.name)).toEqual(["a", "b"]);
      expect(await count("fx_members")).toBe(6);
    });

    test("sequence cycles across a batch", async () => {
      const members = await MemberFactory.new()
        .sequence({ name: "x" }, (i) => ({ name: `y${i}` }))
        .count(4)
        .create();
      expect(members.map((m) => m.name)).toEqual(["x", "y2", "x", "y4"]);
    });

    test("createQuietly skips model events", async () => {
      let fired = 0;
      Member.creating(() => { fired++; });
      await MemberFactory.new().createQuietly();
      expect(fired).toBe(0);
      await MemberFactory.new().create();
      expect(fired).toBe(1);
    });

    test("configure() runs once before the first build", async () => {
      let runs = 0;
      class ConfiguredFactory extends MemberFactory {
        configure() { runs++; return this.state({ name: "configured" }); }
      }
      const f = ConfiguredFactory.new();
      await f.create();
      await f.create();
      expect(runs).toBe(1);
      expect(await count("fx_members")).toBe(2);
    });
  },
);
