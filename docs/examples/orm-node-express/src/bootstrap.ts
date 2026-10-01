import { schemaFor } from "@bunyad/database";
import { getConnection } from "./db.ts";
import { User } from "./models/user.ts";

/**
 * Ensure the `users` table exists and seed a couple of rows when empty.
 */
export async function bootstrap(): Promise<void> {
  const connection = getConnection();
  const schema = schemaFor(connection);

  if (!(await schema.hasTable("users"))) {
    await schema.create("users", (table) => {
      table.id();
      table.string("email").unique();
      table.string("name");
      table.timestamps();
    });
  }

  const count = await User.query().count();
  if (count === 0) {
    await User.create({ email: "ada@example.com", name: "Ada Lovelace" });
    await User.create({ email: "grace@example.com", name: "Grace Hopper" });
  }
}
