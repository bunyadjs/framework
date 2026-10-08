import { ServiceProvider } from "@bunyad/core";
import { Gate } from "@bunyad/auth";
import { Cache } from "@bunyad/cache";
import { DB, type Connection } from "@bunyad/database";
import {
  CacheVersionStore,
  Permissions,
  ScopeTree,
  installPermissionGate,
  registerPermissionCommands,
  registerPermissionMiddleware,
  setPermissions,
  PUBLISH_TAGS,
  stubPath,
  type PermissionTables,
  type ScopeParentResolver,
  type Subject,
} from "@bunyad/permissions";

export type PermissionsConfig = {
  /** Database connection name. Defaults to the bound `db`. */
  connection?: string;
  /** Cache store for counters and snapshots: a store name, `false` for none. Defaults to the default store. */
  cache?: string | false;
  /** `eventual` (default) trusts memory for `ttl` seconds; `strict` re-checks counters on every request. */
  consistency?: "strict" | "eventual";
  /** Seconds a process trusts its own memory in `eventual` mode (default 5). */
  ttl?: number;
  /** Permission names the app declares, for `permissions:sync`. */
  declared?: string[] | (() => string[] | Promise<string[]>);
  /** Scopes whose role snapshots are built at boot and by `permissions:warm` (default: none at boot). */
  warm?: string[];
  /** Scope for checks that name none, usually the current tenant. */
  defaultScope?: () => string | Promise<string>;
  /** Evaluated first; `true` allows everything. */
  superAdmin?: (subject: Subject, scope: string) => boolean | Promise<boolean>;
  /** How scopes find their parent: `{ team: { parent: (id) => 'tenant:' + ... } }`. */
  scopes?: Record<string, { parent: ScopeParentResolver }>;
  /**
   * `column` grant source: keep a subject type's grants in a text column on its own row, so a loaded user
   * needs no grants query: `{ user: { table: "users", column: "permission_access" } }`.
   * Add the column with `addAccessColumn`, then run `permissions:rebuild user`.
   */
  columns?: Record<string, { table: string; column: string; key?: string }>;
  /** Subjects with more grants than this use the grants table instead of the column (default 100). */
  maxColumnGrants?: number;
  /** Use differently named tables, for example `{ roles: "acl_roles" }`. Edit the published migration to match. */
  tables?: Partial<PermissionTables>;
  /** Install the Gate hook (default true). */
  gate?: boolean;
  /** Register `permission`, `permission.any` and `role` middleware (default true). */
  middleware?: boolean;
  /** Register `permissions:*` commands (default true). */
  commands?: boolean;
  /** Throw on unknown permission names. Defaults to on outside production. */
  strict?: boolean;
};

/**
 * Wire `@bunyad/permissions` from `config/permissions.ts`.
 * Does nothing unless that config exists, so apps that do not use permissions pay nothing.
 */
export class PermissionServiceProvider extends ServiceProvider {
  register(): void {
    // Always available, so a migration can be published before the package is configured.
    this.publishes(
      {
        [stubPath("2026_10_09_000000_create_permission_tables.ts")]: "database/migrations/2026_10_09_000000_create_permission_tables.ts",
        [stubPath("2026_10_09_000100_add_permission_access_to_users_table.ts")]:
          "database/migrations/2026_10_09_000100_add_permission_access_to_users_table.ts",
      },
      PUBLISH_TAGS.migrations,
    );
    this.publishes({ [stubPath("permissions.ts")]: "config/permissions.ts" }, PUBLISH_TAGS.config);

    const config = this.app.config.get<PermissionsConfig>("permissions");
    if (!config) return;

    const db = config.connection ? DB.connection(config.connection) : this.app.make<Connection>("db");
    const scopes = new ScopeTree();
    for (const [type, scope] of Object.entries(config.scopes ?? {})) scopes.parent(type, scope.parent);

    const store = config.cache === false ? undefined : Cache.store(config.cache);
    const permissions = new Permissions({
      db,
      scopes,
      cache: store ? { get: (key) => store.get(key), put: (key, value, ttl) => store.put(key, value, ttl) } : undefined,
      versions: store ? new CacheVersionStore(store) : undefined,
      consistency: config.consistency,
      ttlMs: config.ttl === undefined ? undefined : config.ttl * 1000,
      defaultScope: config.defaultScope,
      superAdmin: config.superAdmin,
      columns: config.columns,
      tables: config.tables,
      maxColumnGrants: config.maxColumnGrants,
      strict: config.strict,
    });
    setPermissions(permissions);
    this.app.instance("permissions", permissions);
  }

  async boot(): Promise<void> {
    const config = this.app.config.get<PermissionsConfig>("permissions");
    if (!config) return;

    const permissions = this.app.make<Permissions>("permissions");
    // The Gate is reset when auth registers, so the hook goes in at boot.
    if (config.gate !== false) installPermissionGate(Gate, () => permissions);
    if (config.middleware !== false) registerPermissionMiddleware(() => permissions);
    if (config.commands !== false) {
      const declared = config.declared;
      registerPermissionCommands({
        permissions: () => permissions,
        declared: typeof declared === "function" ? declared : () => declared ?? [],
        warm: () => config.warm ?? ["*"],
      });
    }
    if (config.warm?.length) {
      try {
        await permissions.warm(config.warm);
      } catch {
        // The tables may not exist yet (first boot before migrate): checks warm themselves on demand.
      }
    }
  }
}
