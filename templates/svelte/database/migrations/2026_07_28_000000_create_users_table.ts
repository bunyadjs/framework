import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("users", (table) => {
    table.id();
    table.string("name");
    table.string("email").unique();
    table.timestamp("email_verified_at").nullable();
    table.string("password");
    table.rememberToken();
    table.timestamps();
  });

  await schema.create("password_reset_tokens", (table) => {
    table.string("email").primary();
    table.string("token");
    table.integer("created_at");
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("password_reset_tokens");
  await schema.dropIfExists("users");
}
