import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("notifications", (table) => {
    table.string("id");
    table.string("type");
    table.string("notifiable_type");
    table.string("notifiable_id");
    table.text("data");
    table.string("read_at").nullable();
    table.timestamps();
  });
  await schema.raw(
    "CREATE UNIQUE INDEX notifications_id_unique ON notifications (id)",
  );
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("notifications");
}
