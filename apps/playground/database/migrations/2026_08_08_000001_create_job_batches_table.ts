import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("job_batches", (table) => {
    table.string("id").primary();
    table.string("name");
    table.integer("total_jobs");
    table.integer("pending_jobs");
    table.integer("failed_jobs");
    table.text("failed_job_ids");
    table.integer("cancelled_at").nullable();
    table.integer("created_at");
    table.integer("finished_at").nullable();
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("job_batches");
}
