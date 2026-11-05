import { beforeAll, describe, expect, test } from "bun:test";
import { Model } from "../src/index.ts";
import { testDrivers } from "./test-drivers.ts";

const drivers = await testDrivers();

class WoItem extends Model {
  static table = "wo_items";
}

describe("where conditions keep the order they were written in", () => {
  beforeAll(() => {
    Model.setConnection(drivers[0]!.connection);
  });

  const sql = (build: (q: any) => void) => {
    const query = WoItem.query().where((inner: any) => build(inner));
    return query.toSql();
  };

  test("whereIn then orWhereNull stays IN … OR NULL", () => {
    const out = sql((q) => q.whereIn("branch_id", ["a"]).orWhereNull("branch_id"));
    expect(out).toMatch(/\("branch_id" IN \(\?\) OR "branch_id" IS NULL\)/);
  });

  test("whereNull then orWhereIn stays NULL … OR IN", () => {
    const out = sql((q) => q.whereNull("branch_id").orWhereIn("branch_id", ["a"]));
    expect(out).toMatch(/\("branch_id" IS NULL OR "branch_id" IN \(\?\)\)/);
  });

  test("plain, IN, null and like keep their written order", () => {
    const out = sql((q) =>
      q
        .whereLike("name", "%x%")
        .orWhereIn("branch_id", ["a"])
        .orWhere("kind", "=", "k")
        .orWhereNull("deleted_by"),
    );
    expect(out).toMatch(
      /\("?name"? LIKE \?.* OR "branch_id" IN \(\?\) OR "kind" = \? OR "deleted_by" IS NULL\)/,
    );
  });

  test("a cloned query keeps the order", () => {
    const base = WoItem.query().where((q: any) =>
      q.whereIn("branch_id", ["a"]).orWhereNull("branch_id"),
    );
    expect(base.clone().toSql()).toMatch(/"branch_id" IN \(\?\) OR "branch_id" IS NULL/);
  });
});
