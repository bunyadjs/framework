import type { Schema } from "@bunyad/database";
import { DEFAULT_TABLES, type PermissionTables } from "./store.ts";

/**
 * Create the four tables. `grants.kind`: 1 = role, 2 = permission.
 * `expires_at` is unix seconds. Wildcards (`posts.*`, `*`) are rows in `permissions`.
 */
export async function createPermissionTables(schema: Schema, names: Partial<PermissionTables> = {}): Promise<void> {
  const t = { ...DEFAULT_TABLES, ...names };
  await schema.create(t.permissions, (table) => {
    table.id();
    table.string("name", 191).unique();
    table.string("group_name", 64).nullable();
    table.string("description").nullable();
  });

  await schema.create(t.roles, (table) => {
    table.id();
    table.string("scope", 96);
    table.string("name", 96);
    table.smallInteger("is_system").default(0);
    table.timestamps();
    table.unique(["scope", "name"], `${t.roles}_scope_name_unique`);
  });

  await schema.create(t.role_permissions, (table) => {
    table.integer("role_id");
    table.integer("permission_id");
    table.primary(["role_id", "permission_id"]);
    table.index("permission_id", `${t.role_permissions}_permission_idx`);
  });

  await schema.create(t.grants, (table) => {
    table.string("subject_type", 32);
    table.string("subject_id", 40);
    table.string("scope", 96);
    table.smallInteger("kind");
    table.integer("target_id");
    table.bigInteger("expires_at").nullable();
    table.bigInteger("created_at");
    table.primary(["subject_type", "subject_id", "scope", "kind", "target_id"]);
    table.index(["scope", "kind", "target_id"], `${t.grants}_target_idx`);
  });
}

export async function dropPermissionTables(schema: Schema, names: Partial<PermissionTables> = {}): Promise<void> {
  const t = { ...DEFAULT_TABLES, ...names };
  for (const name of [t.grants, t.role_permissions, t.roles, t.permissions]) {
    await schema.dropIfExists(name);
  }
}

/** Add the nullable text column the `column` grant source keeps a subject's grants in. */
export async function addAccessColumn(schema: Schema, table: string, column = "permission_access"): Promise<void> {
  await schema.table(table, (t) => {
    t.text(column).nullable();
  });
}
