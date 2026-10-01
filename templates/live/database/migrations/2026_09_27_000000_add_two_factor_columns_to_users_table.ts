import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.text("two_factor_secret").nullable();
    table.text("two_factor_recovery_codes").nullable();
    table.timestamp("two_factor_confirmed_at").nullable();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.dropColumn("two_factor_secret");
    table.dropColumn("two_factor_recovery_codes");
    table.dropColumn("two_factor_confirmed_at");
  });
}
