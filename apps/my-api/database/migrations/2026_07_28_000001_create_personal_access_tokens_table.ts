import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("personal_access_tokens", (table) => {
    table.id();
    table.string("tokenable_type");
    table.integer("tokenable_id");
    table.string("name");
    table.string("token").unique();
    table.string("abilities").default("*");
    table.integer("expires_at").nullable();
    table.timestamps();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("personal_access_tokens");
}
