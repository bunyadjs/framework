import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.string("email").unique();
    table.string("password");
    table.timestamp("email_verified_at").nullable();
    table.timestamps();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("users");
}
