import { definePermissions } from "@bunyad/permissions";

/**
 * Permissions for the app. Published by `bunyad publish --tag=permissions-config`.
 * Everything is optional: delete what you do not need.
 */

/** Permission names: group + action. Run `bunyad permissions:sync` after changing them. */
export const permissions = definePermissions({
  posts: ["view", "create", "update", "delete"],
  settings: ["manage"],
});

export default {
  /** Names for `bunyad permissions:sync`. */
  declared: permissions,

  /** Database connection (default: the app connection). */
  // connection: "default",

  /** Cache store for counters and snapshots (a store name, or false for in-process only). */
  // cache: "redis",

  /** "eventual": memory is trusted for `ttl` seconds. "strict": counters are checked on every request. */
  consistency: "eventual" as const,
  ttl: 5,

  /** Scope used when a check names none. Return the current tenant here, for example "tenant:7". */
  // defaultScope: () => "*",

  /** Who may do anything. Evaluated first; keep it cheap. */
  // superAdmin: (subject) => subject.id === 1,

  /** Scope parents: a team belongs to a tenant, so tenant roles apply inside its teams. */
  // scopes: { team: { parent: (id) => `tenant:${tenantOfTeam(id)}` } },

  /** Different table names (also change them in the published migration). */
  // tables: { roles: "acl_roles" },

  /** Keep each user's grants on the user row: no grants query for a loaded user. */
  // columns: { user: { table: "users", column: "permission_access" } },

  /** Turn pieces off. All default to on. */
  // gate: false, middleware: false, commands: false,
};
