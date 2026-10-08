import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

describe.each(drivers.map((d) => [d.name, d] as const))(
  "getPrevious / isClean (%s)",
  (_name, driver) => {
    class Person extends Model {
      static table = "dirty_people";
      static fillable = ["name", "email", "age"];
      declare name: string;
      declare email: string;
      declare age: number;
    }

    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      await schema.dropIfExists("dirty_people");
      await schema.create("dirty_people", (t) => {
        t.id();
        t.string("name");
        t.string("email").nullable();
        t.integer("age").nullable();
        t.timestamps();
      });
    });

    afterAll(async () => {
      await schemaFor(driver.connection).dropIfExists("dirty_people");
    });

    test("empty after create", async () => {
      const p = await Person.create({ name: "Ada", email: "a@x.io", age: 36 });
      expect(p.getPrevious()).toEqual({});
      expect(p.isClean()).toBe(true);
    });

    test("holds original values of changed attributes after save", async () => {
      const p = await Person.create({ name: "Ada", email: "a@x.io", age: 36 });
      p.name = "Ada L";
      p.age = 37;
      expect(p.isClean("email")).toBe(true);
      expect(p.isClean("name")).toBe(false);
      await p.save();

      expect(p.getPrevious("name")).toBe("Ada");
      expect(p.getPrevious("age")).toBe(36);
      expect(p.getPrevious()).not.toHaveProperty("email");
      expect(p.wasChanged("name", "age")).toBe(true);
    });

    test("survives a database round-trip", async () => {
      const p = await Person.create({ name: "Bob", age: 1 });
      p.age = 2;
      await p.save();
      const fresh = (await Person.find(p.id as number)) as Person;
      expect(fresh.age).toBe(2);
      expect(p.getPrevious("age")).toBe(1);
      expect(fresh.getPrevious()).toEqual({});
    });

    test("resets on the next save", async () => {
      const p = await Person.create({ name: "Cy", age: 1 });
      p.age = 2;
      await p.save();
      p.name = "Cyrus";
      await p.save();
      expect(p.getPrevious("name")).toBe("Cy");
      expect(p.getPrevious()).not.toHaveProperty("age");
    });

    test("no-op save leaves previous empty", async () => {
      const p = await Person.create({ name: "Di", age: 5 });
      await p.save();
      expect(p.getPrevious()).toEqual({});
    });
  },
);
