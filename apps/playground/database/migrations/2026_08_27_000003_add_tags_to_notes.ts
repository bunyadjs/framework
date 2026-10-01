import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.table("notes", (table) => {
    table.string("tags").nullable();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.table("notes", (table) => {
    table.dropColumn("tags");
  });
}
