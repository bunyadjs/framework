import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "morphToMany pivot operations (%s)",
  (_name, driver) => {
    class Role extends Model {
      static table = "mo_roles";
      static fillable = ["name"];
      declare id: number;
    }
    class Contact extends Model {
      static table = "mo_contacts";
      static fillable = ["name", "tenant_id"];
      declare id: number;
      roles() {
        return this.morphToMany(Role, "contact", {
          table: "mo_model_has_roles",
          foreignPivotKey: "model_id",
          relatedPivotKey: "role_id",
          morphTypes: ["contact"],
          pivotTenantKey: "tenant_id",
        });
      }
    }
    const tables = ["mo_model_has_roles", "mo_roles", "mo_contacts"];
    const pivot = () =>
      driver.connection.all<Record<string, unknown>>(
        "SELECT * FROM mo_model_has_roles ORDER BY model_id, role_id",
      );

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
      await schema.create("mo_contacts", (b) => { b.id(); b.string("name"); b.string("tenant_id"); b.timestamps(); });
      await schema.create("mo_roles", (b) => { b.id(); b.string("name"); b.timestamps(); });
      await schema.create("mo_model_has_roles", (b) => {
        b.integer("role_id");
        b.string("model_type");
        b.integer("model_id");
        b.string("tenant_id");
        b.string("note").nullable();
      });
    });
    beforeEach(async () => {
      await driver.connection.run("DELETE FROM mo_model_has_roles");
    });
    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of tables) await schema.dropIfExists(t);
    });

    async function seed(n = 4) {
      const contact = await Contact.create({ name: "c", tenant_id: "t1" });
      const roles: Role[] = [];
      for (let i = 0; i < n; i++) roles.push(await Role.create({ name: `r${i}` }));
      return { contact, ids: roles.map((r) => r.id) };
    }

    test("attach writes morph type and tenant, in one batch", async () => {
      const { contact, ids } = await seed();
      await contact.roles().attach(ids);
      const rows = await pivot();
      expect(rows).toHaveLength(4);
      expect(rows.every((r) => r.model_type === "contact" && r.tenant_id === "t1")).toBe(true);
    });

    test("large attach is chunked", async () => {
      const { contact } = await seed(0);
      await contact.roles().attach(Array.from({ length: 2000 }, (_, i) => i + 1));
      const [{ c }] = await driver.connection.all<{ c: number }>(
        "SELECT COUNT(*) AS c FROM mo_model_has_roles",
      );
      expect(Number(c)).toBe(2000);
    });

    test("sync is diff-based and keeps untouched rows", async () => {
      const { contact, ids } = await seed();
      await contact.roles().attach(ids.slice(0, 2));
      await driver.connection.run("UPDATE mo_model_has_roles SET note = 'keep' WHERE role_id = ?", [ids[0]]);
      const res = await contact.roles().sync([ids[0]!, ids[2]!]);
      expect(res.attached.map(String)).toEqual([String(ids[2])]);
      expect(res.detached.map(String)).toEqual([String(ids[1])]);
      const rows = await pivot();
      expect(rows.map((r) => [Number(r.role_id), r.note])).toEqual([
        [ids[0], "keep"],
        [ids[2], null],
      ]);
    });

    test("detach returns the deleted count", async () => {
      const { contact, ids } = await seed();
      await contact.roles().attach(ids);
      expect(await contact.roles().detach([ids[0]!, ids[1]!])).toBe(2);
      expect(await contact.roles().detach()).toBe(2);
    });

    test("syncWithoutDetaching and toggle report changes", async () => {
      const { contact, ids } = await seed();
      await contact.roles().attach([ids[0]!]);
      const a = await contact.roles().syncWithoutDetaching([ids[0]!, ids[1]!]);
      expect(a.attached.map(String)).toEqual([String(ids[1])]);
      expect(a.detached).toEqual([]);
      const t = await contact.roles().toggle([ids[0]!, ids[2]!]);
      expect(t.detached.map(String)).toEqual([String(ids[0])]);
      expect(t.attached.map(String)).toEqual([String(ids[2])]);
    });

    test("another tenant's rows are never touched", async () => {
      const { contact, ids } = await seed();
      await driver.connection.run(
        "INSERT INTO mo_model_has_roles (role_id, model_type, model_id, tenant_id) VALUES (?, 'contact', ?, 't2')",
        [ids[0], contact.id],
      );
      await contact.roles().attach([ids[1]!]);
      await contact.roles().sync([]);
      const rows = await pivot();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.tenant_id).toBe("t2");
    });
  },
);
