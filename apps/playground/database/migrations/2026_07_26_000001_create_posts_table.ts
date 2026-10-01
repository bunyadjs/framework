import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("posts", (table) => {
    table.id();
    table.integer("user_id");
    table.string("title");
    table.timestamps();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("posts");
}
