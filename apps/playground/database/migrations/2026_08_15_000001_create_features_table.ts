import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("features", (table) => {
    table.id();
    table.string("name");
    table.string("scope");
    table.text("value");
    table.timestamps();
  });
  await schema.raw(
    "CREATE UNIQUE INDEX features_name_scope_unique ON features (name, scope)",
  );
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("features");
}
