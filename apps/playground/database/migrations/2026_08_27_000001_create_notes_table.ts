import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("notes", (table) => {
    table.string("id").primary();
    table.unsignedBigInteger("user_id");
    table.string("title");
    table.text("body").nullable();
    table.timestamps();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("notes");
}
