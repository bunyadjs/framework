import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("bench_items", (table) => {
    table.id();
    table.string("name");
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("bench_items");
}
