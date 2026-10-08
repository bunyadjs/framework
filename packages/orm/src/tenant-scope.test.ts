import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

/** The tenant of the current request; `null` means "no tenant" (console, admin). */
let currentTenant: number | null = null;

class TsProject extends Model {
  static table = "ts_projects";
  static fillable = ["name", "tenant_id"];
  declare id: number;
  declare name: string;
  declare tenant_id: number;
  static booted() {
    // Every read, update and delete is limited to the current tenant …
    TsProject.addGlobalScope("tenant", (q) => {
      if (currentTenant !== null) q.where("ts_projects.tenant_id", currentTenant);
    });
    // … and new rows are stamped with it.
    TsProject.creating((model) => {
      const project = model as TsProject;
      if (currentTenant !== null && project.tenant_id === undefined) project.tenant_id = currentTenant;
    });
  }
  tasks() {
    return this.hasMany(TsTask, "project_id");
  }
}
class TsTask extends Model {
  static table = "ts_tasks";
  static fillable = ["project_id", "title"];
  declare id: number;
  declare title: string;
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "tenant scoping with a global scope and a creating listener (%s)",
  (_name, driver) => {
    const c = driver.connection;
    const tables = ["ts_tasks", "ts_projects"];

    beforeAll(async () => {
      Model.setConnection(c);
      TsProject.addGlobalScope("tenant", (q) => {
        if (currentTenant !== null) q.where("ts_projects.tenant_id", currentTenant);
      });
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("ts_projects", (b) => { b.id(); b.integer("tenant_id"); b.string("name"); b.timestamps(); });
      await schema.create("ts_tasks", (b) => { b.id(); b.integer("project_id"); b.string("title"); b.timestamps(); });
      currentTenant = 1;
      const a = await TsProject.create({ name: "a1" });
      await TsProject.create({ name: "a2" });
      currentTenant = 2;
      const b = await TsProject.create({ name: "b1" });
      await TsTask.create({ project_id: a.id, title: "ta" });
      await TsTask.create({ project_id: b.id, title: "tb" });
    });
    afterAll(async () => {
      currentTenant = null;
      const schema = schemaFor(c);
      for (const t of tables) await schema.dropIfExists(t);
    });

    test("creating stamps the current tenant", async () => {
      currentTenant = null;
      const rows = await TsProject.orderBy("id").get();
      expect(rows.all().map((p) => `${p.name}:${p.tenant_id}`)).toEqual(["a1:1", "a2:1", "b1:2"]);
    });

    test("reads only see the current tenant", async () => {
      currentTenant = 1;
      expect((await TsProject.orderBy("id").get()).pluck("name").all()).toEqual(["a1", "a2"]);
      expect(await TsProject.count()).toBe(2);
      currentTenant = 2;
      expect((await TsProject.get()).pluck("name").all()).toEqual(["b1"]);
    });

    test("find, first and lookups cannot reach another tenant's rows", async () => {
      currentTenant = 1;
      const other = (await TsProject.withoutGlobalScopes().where("name", "b1").first())!;
      expect(await TsProject.find(other.id)).toBeNull();
      expect(await TsProject.where("name", "b1").first()).toBeNull();
      expect(await TsProject.where("name", "b1").exists()).toBe(false);
    });

    test("bulk update and delete stay inside the tenant", async () => {
      currentTenant = 1;
      await TsProject.query().update({ name: "renamed" });
      currentTenant = null;
      expect((await TsProject.orderBy("id").get()).pluck("name").all()).toEqual(["renamed", "renamed", "b1"]);
      currentTenant = 2;
      await TsProject.query().where("name", "renamed").delete();
      currentTenant = null;
      expect(await TsProject.count()).toBe(3);
      await TsProject.query().where("name", "renamed").update({ name: "a" });
    });

    test("relations from the tenant scoped model", async () => {
      currentTenant = 1;
      const projects = await TsProject.with("tasks").orderBy("id").get();
      const titles = projects.all().flatMap((p) => (p as unknown as { tasks: { pluck(k: string): { all(): string[] } } }).tasks.pluck("title").all());
      expect(titles).toEqual(["ta"]);
      expect(await TsProject.has("tasks").count()).toBe(1);
    });

    test("withoutGlobalScopes gives the cross-tenant view", async () => {
      currentTenant = 1;
      expect(await TsProject.withoutGlobalScopes().count()).toBe(3);
      expect(await TsProject.withoutGlobalScope("tenant").count()).toBe(3);
    });

    test("an explicit tenant_id on create is kept", async () => {
      currentTenant = 1;
      const p = await TsProject.create({ name: "forced", tenant_id: 2 });
      currentTenant = 2;
      expect((await TsProject.find(p.id))?.name).toBe("forced");
    });
  },
);
