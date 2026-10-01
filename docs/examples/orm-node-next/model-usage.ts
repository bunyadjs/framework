/**
 * Optional sketch: Bunyad Model on the shared Next connection.
 * Models are plain Bunyad classes — no Nest `@Entity()` / Prisma schema fork.
 */
import "server-only";

import { Model } from "@bunyad/orm";
import { getConnection } from "./db.ts";

// Ensure the shared connection is registered before Model queries.
getConnection();

export class User extends Model {
  static table = "users";
  declare id: number;
  declare email: string;
}

export async function listUsers() {
  return User.query().limit(10).get();
}
