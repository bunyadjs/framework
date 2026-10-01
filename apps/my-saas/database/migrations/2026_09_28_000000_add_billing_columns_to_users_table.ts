import type { Schema } from "@bunyad/database";

/** Stripe customer and plan columns used by `@bunyad/billing`'s `Billable`. */
export async function up(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    table.string("plan").default("free");
    table.string("stripe_id").nullable();
    table.string("pm_type").nullable();
    table.string("pm_last_four", 4).nullable();
    table.timestamp("trial_ends_at").nullable();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.table("users", (table) => {
    for (const column of ["plan", "stripe_id", "pm_type", "pm_last_four", "trial_ends_at"]) {
      table.dropColumn(column);
    }
  });
}
