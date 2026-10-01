import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("jobs", (table) => {
    table.id();
    table.string("queue");
    table.text("payload");
    table.integer("attempts").default(0);
    table.integer("reserved_at").nullable();
    table.integer("available_at");
    table.integer("created_at");
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("jobs");
}
