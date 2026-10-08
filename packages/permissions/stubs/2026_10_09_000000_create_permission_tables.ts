import type { Schema } from "@bunyad/database";

/**
 * Roles, permissions and grants for @bunyad/permissions.
 *
 * Published by `bunyad publish --tag=permissions-migrations`; this copy is yours to edit.
 * If you rename a table, set the same name under `tables` in config/permissions.ts.
 * Keep the column names and types: the package queries them.
 *
 *  - permissions       declared permission names (wildcards such as "posts.*" are rows too)
 *  - roles             a named bundle of permissions, per scope ("*" = global, "tenant:7", "team:42")
 *  - role_permissions  which permissions a role holds
 *  - grants            what a subject (user, token, service account) holds, per scope
 *                      kind: 1 = role, 2 = permission; expires_at is unix seconds
 */
export async function up(schema: Schema): Promise<void> {
  await schema.create("permissions", (table) => {
    table.id();
    table.string("name", 191).unique();
    table.string("group_name", 64).nullable();
    table.string("description").nullable();
  });

  await schema.create("roles", (table) => {
    table.id();
    table.string("scope", 96);
    table.string("name", 96);
    table.smallInteger("is_system").default(0);
    table.timestamps();
    table.unique(["scope", "name"], "roles_scope_name_unique");
  });

  await schema.create("role_permissions", (table) => {
    table.integer("role_id");
    table.integer("permission_id");
    table.primary(["role_id", "permission_id"]);
    table.index("permission_id", "role_permissions_permission_idx");
  });

  await schema.create("grants", (table) => {
    table.string("subject_type", 32);
    // Wide enough for integer, UUID and ULID keys.
    table.string("subject_id", 40);
    table.string("scope", 96);
    table.smallInteger("kind");
    table.integer("target_id");
    table.bigInteger("expires_at").nullable();
    table.bigInteger("created_at");
    table.primary(["subject_type", "subject_id", "scope", "kind", "target_id"]);
    table.index(["scope", "kind", "target_id"], "grants_target_idx");
  });
}

export async function down(schema: Schema): Promise<void> {
  await schema.dropIfExists("grants");
  await schema.dropIfExists("role_permissions");
  await schema.dropIfExists("roles");
  await schema.dropIfExists("permissions");
}
