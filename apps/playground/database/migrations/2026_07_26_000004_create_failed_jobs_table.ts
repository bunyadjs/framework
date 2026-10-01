import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("failed_jobs", (table) => {
    table.id();
    table.string("uuid").unique();
    table.string("queue");
    table.text("payload");
    table.text("exception");
    table.integer("failed_at");
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("failed_jobs");
}
