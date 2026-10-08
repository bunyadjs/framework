import type { Schema } from "@bunyad/database";

/**
 * Optional: lets a loaded user answer permission checks with no grants query (the `column` source).
 * Published by `bunyad publish --tag=permissions-migrations`. Skip or delete this file if you do not
 * use it. After migrating, set `columns` in config/permissions.ts and run `bunyad permissions:rebuild user`.
 */
export async function up(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.text("permission_access").nullable();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.dropColumn("permission_access");
  });
}
