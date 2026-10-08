// Every example in the "Query builder reference" docs section, run against real databases.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { schemaFor } from "@bunyad/database";
import { Model } from "../src/index.ts";
import { testDrivers, type TestDriver } from "./test-drivers.ts";

const drivers: TestDriver[] = await testDrivers();

class DqUser extends Model {
  static table = "dq_users";
  static fillable = ["name", "email", "status", "age", "secret"];
  static hidden = ["secret"];
  declare id: number;
  declare name: string;
  declare status: string;
  declare age: number;
  posts() { return this.hasMany(DqPost, "user_id"); }
}
class DqPost extends Model {
  static table = "dq_posts";
  static fillable = ["user_id", "title"];
}

describe.each(drivers.map((d) => [d.name, d] as const))(
  "query builder reference examples (%s)",
  (_name, driver) => {
    beforeAll(async () => {
      Model.setConnection(driver.connection);
      const schema = schemaFor(driver.connection);
      for (const t of ["dq_posts", "dq_users"]) await schema.dropIfExists(t);
      await schema.create("dq_users", (b) => {
        b.id(); b.string("name"); b.string("email").nullable(); b.string("status"); b.integer("age"); b.string("secret").nullable(); b.timestamps();
      });
      await schema.create("dq_posts", (b) => { b.id(); b.integer("user_id"); b.string("title"); b.timestamps(); });
      const rows = [
        ["ann", "ann@x.io", "active", 20], ["bob", null, "active", 30], ["cy", "cy@x.io", "banned", 40], ["di", null, "banned", 50], ["ed", "ed@x.io", "active", 60],
      ] as const;
      for (const [name, email, status, age] of rows) await DqUser.create({ name, email, status, age, secret: "s" });
      await DqPost.create({ user_id: 1, title: "p1" });
    });
    afterAll(async () => {
      const schema = schemaFor(driver.connection);
      for (const t of ["dq_posts", "dq_users"]) await schema.dropIfExists(t);
    });
    const names = async (q: { get(): unknown }) => ((await q.get()) as { pluck(c: string): { all(): string[] } }).pluck("name").all().sort();

    test("whereNot with a column or a closure", async () => {
      expect(await names(DqUser.whereNot("status", "banned"))).toEqual(["ann", "bob", "ed"]);
      expect(await names(DqUser.whereNot("age", ">", 35))).toEqual(["ann", "bob"]);
      expect(await names(DqUser.whereNot((q) => q.where("status", "banned").where("age", ">", 45)))).toEqual(["ann", "bob", "cy", "ed"]);
      expect(await names(DqUser.where("age", "<", 25).orWhereNot("status", "active"))).toEqual(["ann", "cy", "di"]);
    });

    test("whereAny / whereAll / whereNone", async () => {
      expect(await names(DqUser.query().whereAny(["name", "email"], "like", "%x.io"))).toEqual(["ann", "cy", "ed"]);
      expect(await names(DqUser.query().whereAll(["name", "status"], "like", "%a%"))).toEqual(["ann"]);
      expect(await names(DqUser.query().whereNone(["name", "status"], "like", "%o%"))).toEqual(["ann", "cy", "di", "ed"]);
    });

    test("orWhere* variants", async () => {
      expect(await names(DqUser.where("name", "ann").orWhereIn("name", ["bob"]))).toEqual(["ann", "bob"]);
      expect(await names(DqUser.where("name", "ann").orWhereNull("email"))).toEqual(["ann", "bob", "di"]);
      expect(await names(DqUser.where("name", "ann").orWhereNotNull("email"))).toEqual(["ann", "cy", "ed"]);
      expect(await names(DqUser.where("name", "zzz").orWhereBetween("age", [25, 45]))).toEqual(["bob", "cy"]);
      expect(await names(DqUser.where("name", "zzz").orWhereNotBetween("age", [25, 55]))).toEqual(["ann", "ed"]);
      expect(await names(DqUser.where("name", "zzz").orWhereNotIn("name", ["ann", "bob", "cy"]))).toEqual(["di", "ed"]);
      expect(await names(DqUser.where("name", "zzz").orWhereRaw("age > ?", [55]))).toEqual(["ed"]);
      expect(await names(DqUser.where("name", "zzz").orWhereLike("name", "a%"))).toEqual(["ann"]);
      expect(await names(DqUser.where("name", "zzz").orWhereNotLike("name", "%n%"))).toEqual(["bob", "cy", "di", "ed"]);
      expect(await names(DqUser.where("name", "zzz").orWhereColumn("name", "email"))).toEqual([]);
    });

    test("whereKey, whereKeyNot, take, forPage, distinct", async () => {
      expect(await names(DqUser.query().whereKey([1, 2]))).toEqual(["ann", "bob"]);
      expect(await names(DqUser.query().whereKeyNot(1))).toEqual(["bob", "cy", "di", "ed"]);
      expect((await DqUser.query().orderBy("id").take(2).get()).count()).toBe(2);
      expect((await DqUser.query().orderBy("id").forPage(2, 2).get()).pluck("name").all()).toEqual(["cy", "di"]);
      expect((await DqUser.query().select("status").distinct().rows().get()).length).toBe(2);
    });

    test("joins, tap, firstOr", async () => {
      const joined = await DqUser.query().leftJoin("dq_posts", "dq_posts.user_id", "=", "dq_users.id").select("dq_users.*").whereNull("dq_posts.id").get();
      expect(joined.count()).toBe(4);
      let tapped = false;
      await DqUser.query().tap(() => { tapped = true; }).get();
      expect(tapped).toBe(true);
      expect((await DqUser.where("name", "nobody").firstOr(() => DqUser.firstOrFail()))).toBeTruthy();
    });

    test("toRawSql and lock modifiers build SQL", () => {
      expect(DqUser.where("name", "ann").toRawSql()).toContain("ann");
      expect(DqUser.query().sharedLock().toSql()).toBeTruthy();
    });

    test("hidden attributes: makeVisible / makeHidden / setHidden", async () => {
      const u = (await DqUser.find(1)) as DqUser;
      expect(Object.keys(u.toJSON())).not.toContain("secret");
      expect(Object.keys(u.makeVisible("secret").toJSON())).toContain("secret");
      expect(Object.keys(u.makeHidden("secret", "email").toJSON())).not.toContain("email");
      expect(u.setHidden(["name"]).getHidden()).toEqual(["name"]);
    });
  },
);
