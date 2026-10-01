import { expect, test, beforeEach, afterEach } from "bun:test";
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model } from "./index.ts";

let connection: ReturnType<typeof connectSqlite>;

beforeEach(async () => {
  connection = connectSqlite();
  Model.setConnection(connection);
  const schema = schemaFor(connection);
  await schema.create("suppliers", (t) => {
    t.id();
    t.string("name");
  });
  await schema.create("users", (t) => {
    t.id();
    t.string("name");
    t.integer("supplier_id");
  });
  await schema.create("histories", (t) => {
    t.id();
    t.string("note");
    t.integer("user_id");
  });
});

afterEach(() => {
  connection.close?.();
});

test("hasOneThrough lazy get and eager with", async () => {
  class Supplier extends Model {
    static table = "suppliers";
    static timestamps = false;
    static fillable = ["name"];
    userHistory() {
      return this.hasOneThrough(History, User);
    }
  }
  class User extends Model {
    static table = "users";
    static timestamps = false;
    static fillable = ["name", "supplier_id"];
  }
  class History extends Model {
    static table = "histories";
    static timestamps = false;
    static fillable = ["note", "user_id"];
  }

  const supplier = await Supplier.create({ name: "Acme" });
  const user = await User.create({ name: "Ada", supplier_id: supplier.id });
  await History.create({ note: "first", user_id: user.id });
  await History.create({ note: "second", user_id: user.id });

  const lazy = await supplier.userHistory().get();
  expect(lazy).not.toBeNull();
  expect((lazy as History).note).toBe("first");

  const eager = await Supplier.with("userHistory").where("id", supplier.id).first();
  expect(eager).not.toBeNull();
  const history = (eager as unknown as { userHistory: History | null }).userHistory;
  expect(history?.note).toBe("first");
});
