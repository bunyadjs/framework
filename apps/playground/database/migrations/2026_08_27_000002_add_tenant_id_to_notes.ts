import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.string("tenant_id").default("demo");
  });
  await schema.table("notes", (table) => {
    table.string("tenant_id").default("demo");
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.dropColumn("tenant_id");
  });
  await schema.table("notes", (table) => {
    table.dropColumn("tenant_id");
  });
}
