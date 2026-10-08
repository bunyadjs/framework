import { bitmapIds, hasBit, emptyBitmap, orInto } from "./bitmap.ts";
import { type AccessColumn, DEFAULT_MAX_COLUMN_GRANTS, encodeAccess } from "./access.ts";
import { PermissionRegistry, isPattern } from "./registry.ts";
import { PermissionResolver, registryKey, scopeKey, subjectKey } from "./resolver.ts";
import { GLOBAL_SCOPE, ScopeTree } from "./scope.ts";
import { PermissionStore, type PermissionTables, type RoleRow } from "./store.ts";
import {
  GRANT_PERMISSION,
  GRANT_ROLE,
  type PermissionsDb,
  RoleNotFoundError,
  type RoleRef,
  type SharedCache,
  type Subject,
  type SubjectLike,
  UnknownPermissionError,
  type VersionStore,
} from "./types.ts";
import { MemoryVersionStore } from "./versions.ts";

export type PermissionsOptions = {
  db: PermissionsDb;
  /** Shared counters. Defaults to in-process; use `CacheVersionStore` with more than one process. */
  versions?: VersionStore;
  cache?: SharedCache;
  scopes?: ScopeTree;
  /** Scope used when a check names none (the current tenant, usually). */
  defaultScope?: () => string | Promise<string>;
  /** Evaluated first; `true` allows everything without touching the database. */
  superAdmin?: (subject: Subject, scope: string) => boolean | Promise<boolean>;
  consistency?: "strict" | "eventual";
  ttlMs?: number;
  /**
   * `column` grant source: keep each subject's grants in a text column on its own row, by subject type
   * (`{ user: { table: 'users', column: 'permission_access' } }`). A loaded user then needs no grants
   * query. The grants table stays the source of truth; the column is kept in step by every grant change.
   */
  columns?: Record<string, AccessColumn>;
  /** Subjects holding more grants than this fall back to the grants table (default 100). */
  maxColumnGrants?: number;
  /** Told when the shared cache or counters fail (checks then answer from the database). Default: a throttled warning. */
  onError?: (error: unknown, where: string) => void;
  /** Use differently named tables, for example `{ roles: 'acl_roles' }`. Publish and edit the migration to match. */
  tables?: Partial<PermissionTables>;
  /** Throw on unknown permission names. Defaults to on outside production. */
  strict?: boolean;
  now?: () => number;
};

/** Anything with `whereRaw`: a model query or a query builder. */
export type WhereRawable = { whereRaw(sql: string, bindings?: unknown[]): unknown };
/** The table behind the subject: `{ table: 'users', key: 'id', type: 'user' }`. */
export type QueryTarget = { table: string; key?: string; type?: string };

export type GrantOptions = { expiresAt?: Date | number | null };
export type SyncResult = { attached: string[]; detached: string[] };

const toSeconds = (value: Date | number | null | undefined): number | null =>
  value == null ? null : value instanceof Date ? Math.floor(value.getTime() / 1000) : value;

/** Attach claims from a signed token or session (see `issueClaims`) to a subject for this request. */
export function withClaims(who: SubjectLike, claims: string | null | undefined): Subject {
  const subject = { ...subjectOf(who) };
  if (typeof claims === "string") subject.access = claims;
  return subject;
}

export function subjectOf(input: SubjectLike): Subject {
  return "permissionSubject" in input ? input.permissionSubject() : input;
}

export class Permissions {
  readonly registry = new PermissionRegistry();
  readonly scopes: ScopeTree;
  readonly store: PermissionStore;
  readonly versions: VersionStore;
  readonly #resolver: PermissionResolver;
  readonly #defaultScope: () => string | Promise<string>;
  readonly #superAdmin?: PermissionsOptions["superAdmin"];
  readonly #strict: boolean;
  readonly #now: () => number;
  readonly #columns: Record<string, AccessColumn>;
  readonly #maxColumnGrants: number;

  constructor(options: PermissionsOptions) {
    this.scopes = options.scopes ?? new ScopeTree();
    this.store = new PermissionStore(options.db, options.tables);
    this.versions = options.versions ?? new MemoryVersionStore();
    this.#now = options.now ?? Date.now;
    this.#columns = options.columns ?? {};
    this.#maxColumnGrants = options.maxColumnGrants ?? DEFAULT_MAX_COLUMN_GRANTS;
    this.#defaultScope = options.defaultScope ?? (() => GLOBAL_SCOPE);
    this.#superAdmin = options.superAdmin;
    this.#strict = options.strict ?? process.env.NODE_ENV !== "production";
    let lastWarning = 0;
    const onError =
      options.onError ??
      ((error: unknown, where: string) => {
        const at = Date.now();
        if (at - lastWarning < 60_000) return;
        lastWarning = at;
        console.warn(`[permissions] ${where} failed, answering from the database: ${(error as Error)?.message ?? error}`);
      });
    this.#resolver = new PermissionResolver({
      onError,
      store: this.store,
      registry: this.registry,
      scopes: this.scopes,
      versions: this.versions,
      cache: options.cache,
      consistency: options.consistency,
      ttlMs: options.ttlMs,
      now: this.#now,
    });
  }

  // --- registry --------------------------------------------------------------

  /** Make sure every name (and wildcard) has an id. Never deletes. */
  async sync(names: string[]): Promise<void> {
    await this.store.insertPermissions([...new Set(names)]);
    await this.#changed([registryKey]);
  }

  /** Is this a declared permission name? Loads the registry on first use. */
  async knows(permission: string): Promise<boolean> {
    await this.#loadRegistry();
    return this.registry.idOf(permission) !== undefined;
  }

  // --- checks ----------------------------------------------------------------

  async can(who: SubjectLike, permission: string, scope?: string): Promise<boolean> {
    const subject = subjectOf(who);
    scope ??= await this.#defaultScope();
    if (this.#superAdmin && (await this.#superAdmin(subject, scope))) return true;
    const set = await this.#resolver.effective(subject, scope);
    const id = this.registry.idOf(permission);
    if (id === undefined) {
      if (this.#strict) throw new UnknownPermissionError(permission);
      return false;
    }
    return hasBit(set.bits, id);
  }

  /** Warm the cache for a subject so synchronous checks (`@can` in views) can answer. */
  async load(who: SubjectLike, scope?: string): Promise<void> {
    const subject = subjectOf(who);
    await this.#resolver.effective(subject, scope ?? (await this.#defaultScope()));
  }

  /**
   * Synchronous check from memory: `true` / `false`, or `undefined` when the answer is not in memory yet
   * (call `load`, or any async check, earlier in the request). Never touches the database.
   */
  canNow(who: SubjectLike, permission: string, scope?: string): boolean | undefined {
    const subject = subjectOf(who);
    const resolved = scope ?? this.#defaultScope();
    if (typeof resolved !== "string") return undefined;
    if (this.#superAdmin) {
      const allowed = this.#superAdmin(subject, resolved);
      if (typeof allowed !== "boolean") return undefined;
      if (allowed) return true;
    }
    const set = this.#resolver.peek(subject, resolved);
    if (!set || this.registry.size === 0) return undefined;
    const id = this.registry.idOf(permission);
    return id === undefined ? false : hasBit(set.bits, id);
  }

  /** Synchronous role check from memory; `undefined` when not loaded yet. */
  hasRoleNow(who: SubjectLike, role: string, scope?: string): boolean | undefined {
    const subject = subjectOf(who);
    const resolved = scope ?? this.#defaultScope();
    if (typeof resolved !== "string") return undefined;
    return this.#resolver.peek(subject, resolved)?.roleNames.has(role);
  }

  async canAny(who: SubjectLike, permissions: string[], scope?: string): Promise<boolean> {
    for (const permission of permissions) if (await this.can(who, permission, scope)) return true;
    return false;
  }

  async canAll(who: SubjectLike, permissions: string[], scope?: string): Promise<boolean> {
    for (const permission of permissions) if (!(await this.can(who, permission, scope))) return false;
    return true;
  }

  async hasRole(who: SubjectLike, role: string, scope?: string): Promise<boolean> {
    const subject = subjectOf(who);
    scope ??= await this.#defaultScope();
    return (await this.#resolver.effective(subject, scope)).roleNames.has(role);
  }

  /** Concrete permission names the subject holds in the scope (for UIs). */
  async permissionNames(who: SubjectLike, scope?: string): Promise<string[]> {
    const subject = subjectOf(who);
    scope ??= await this.#defaultScope();
    const set = await this.#resolver.effective(subject, scope);
    return bitmapIds(set.bits)
      .map((id) => this.registry.nameOf(id))
      .filter((name): name is string => name !== undefined && !isPattern(name))
      .sort();
  }

  // --- roles -----------------------------------------------------------------

  /** Create a role; returns the existing one when the name is taken in that scope. */
  async createRole(name: string, scope = GLOBAL_SCOPE, options: { isSystem?: boolean } = {}): Promise<RoleRow> {
    const existing = (await this.store.findRoles([scope], name))[0];
    if (existing) return existing;
    const id = await this.store.insertRole(scope, name, options.isSystem ?? false, new Date(this.#now()).toISOString().slice(0, 19).replace("T", " "));
    await this.#changed([scopeKey(scope)]);
    return { id, scope, name };
  }

  async givePermissions(role: RoleRef, names: string[]): Promise<string[]> {
    const row = await this.#role(role);
    const ids = await this.#permissionIds(names);
    const current = new Set(await this.store.rolePermissionIds(row.id));
    const toAdd = [...new Set(ids)].filter((id) => !current.has(id));
    if (toAdd.length > 0) {
      await this.store.addRolePermissions(row.id, toAdd);
      await this.#changed([scopeKey(row.scope)]);
    }
    return toAdd.map((id) => this.registry.nameOf(id)!).filter(Boolean);
  }

  async revokePermissions(role: RoleRef, names: string[]): Promise<void> {
    const row = await this.#role(role);
    const ids = await this.#permissionIds(names);
    await this.store.removeRolePermissions(row.id, ids);
    await this.#changed([scopeKey(row.scope)]);
  }

  /** Make the role hold exactly these permissions. */
  async syncPermissions(role: RoleRef, names: string[]): Promise<SyncResult> {
    const row = await this.#role(role);
    const wanted = new Set(await this.#permissionIds(names));
    const current = new Set(await this.store.rolePermissionIds(row.id));
    const toAdd = [...wanted].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !wanted.has(id));
    await this.store.transaction(async () => {
      if (toAdd.length > 0) await this.store.addRolePermissions(row.id, toAdd);
      if (toRemove.length > 0) await this.store.removeRolePermissions(row.id, toRemove);
    });
    if (toAdd.length + toRemove.length > 0) await this.#changed([scopeKey(row.scope)]);
    const name = (id: number) => this.registry.nameOf(id)!;
    return { attached: toAdd.map(name), detached: toRemove.map(name) };
  }

  async deleteRole(role: RoleRef): Promise<void> {
    const row = await this.#role(role);
    const holders = Object.keys(this.#columns).length > 0 ? await this.store.subjectsWithRole(row.id) : [];
    await this.store.transaction(async () => {
      await this.store.deleteRole(row.id);
      // A deleted role's id must not linger in access columns: the id could be reused by a new role.
      for (const holder of holders) {
        const target = this.#columns[holder.type];
        if (target) await this.#writeAccess(holder, target);
      }
    });
    await this.#changed([scopeKey(row.scope), ...holders.map(subjectKey)]);
  }

  /**
   * Copy every role of one scope (with its permissions) into another: tenant onboarding.
   * Idempotent. A handful of statements however many roles there are.
   */
  async copyRoles(from: string, to: string): Promise<RoleRow[]> {
    const source = await this.store.findRoles([from]);
    if (source.length === 0) return [];
    const now = new Date(this.#now()).toISOString().slice(0, 19).replace("T", " ");
    const copies = await this.store.transaction(async () => {
      const existing = new Set((await this.store.findRoles([to])).map((role) => role.name));
      const missing = source.filter((role) => !existing.has(role.name)).map((role) => role.name);
      if (missing.length > 0) await this.store.insertRoles(to, missing, now);
      const targets = await this.store.findRoles([to]);
      const targetByName = new Map(targets.map((role) => [role.name, role]));

      const wanted = await this.store.rolePermissionsOf(source.map((role) => role.id));
      const have = new Set(
        (await this.store.rolePermissionsOf(targets.map((role) => role.id))).map((row) => `${row.roleId}:${row.permissionId}`),
      );
      const sourceName = new Map(source.map((role) => [role.id, role.name]));
      const toAdd = wanted
        .map((row) => ({ roleId: targetByName.get(sourceName.get(row.roleId)!)!.id, permissionId: row.permissionId }))
        .filter((pair) => !have.has(`${pair.roleId}:${pair.permissionId}`));
      if (toAdd.length > 0) await this.store.addRolePermissionPairs(toAdd);
      return source.map((role) => targetByName.get(role.name)!);
    });
    await this.#changed([scopeKey(to)]);
    return copies;
  }

  // --- grants ----------------------------------------------------------------

  async grantRole(who: SubjectLike, role: string, scope = GLOBAL_SCOPE, options: GrantOptions = {}): Promise<void> {
    const subject = subjectOf(who);
    const row = await this.#role({ name: role, scope });
    await this.#mutate(who, subject, () =>
      this.store.upsertGrant(subject, scope, GRANT_ROLE, row.id, toSeconds(options.expiresAt), Math.floor(this.#now() / 1000)),
    );
  }

  async revokeRole(who: SubjectLike, role: string, scope = GLOBAL_SCOPE): Promise<void> {
    const subject = subjectOf(who);
    const row = await this.#role({ name: role, scope });
    await this.#mutate(who, subject, () => this.store.removeGrants(subject, scope, GRANT_ROLE, [row.id]));
  }

  /** Make the subject hold exactly these roles in the scope. */
  async syncRoles(who: SubjectLike, roles: string[], scope = GLOBAL_SCOPE): Promise<SyncResult> {
    const subject = subjectOf(who);
    const chain = await this.scopes.chain(scope);
    const known = await this.store.findRoles(chain);
    const byName = new Map<string, RoleRow>();
    for (const scopeName of chain) for (const row of known) if (row.scope === scopeName) byName.set(row.name, row);
    const byId = new Map(known.map((row) => [row.id, row]));

    const wanted = new Map<number, string>();
    for (const name of roles) {
      const row = byName.get(name);
      if (!row) throw new RoleNotFoundError(name, scope);
      wanted.set(row.id, name);
    }
    const current = (await this.store.grantsOf(subject, scope, GRANT_ROLE)).map((grant) => grant.target);
    const toAdd = [...wanted.keys()].filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !wanted.has(id));
    const now = Math.floor(this.#now() / 1000);
    if (toAdd.length + toRemove.length > 0) {
      await this.#mutate(who, subject, async () => {
        for (const id of toAdd) await this.store.upsertGrant(subject, scope, GRANT_ROLE, id, null, now);
        if (toRemove.length > 0) await this.store.removeGrants(subject, scope, GRANT_ROLE, toRemove);
      });
    }
    return {
      attached: toAdd.map((id) => wanted.get(id)!),
      detached: toRemove.map((id) => byId.get(id)?.name ?? String(id)),
    };
  }

  async grantPermission(who: SubjectLike, permission: string, scope = GLOBAL_SCOPE, options: GrantOptions = {}): Promise<void> {
    const subject = subjectOf(who);
    const [id] = await this.#permissionIds([permission]);
    await this.#mutate(who, subject, () =>
      this.store.upsertGrant(subject, scope, GRANT_PERMISSION, id!, toSeconds(options.expiresAt), Math.floor(this.#now() / 1000)),
    );
  }

  async revokePermission(who: SubjectLike, permission: string, scope = GLOBAL_SCOPE): Promise<void> {
    const subject = subjectOf(who);
    const [id] = await this.#permissionIds([permission]);
    await this.#mutate(who, subject, () => this.store.removeGrants(subject, scope, GRANT_PERMISSION, [id!]));
  }

  // --- access column ----------------------------------------------------------

  /** The column holding a subject type's grants, when the `column` source is configured for it. */
  accessColumnFor(type: string): string | undefined {
    return this.#columns[type]?.column;
  }

  /**
   * Write every subject's access column from the grants table: run after turning the `column` source on,
   * or to repair drift. Subjects without grants get an empty value so readers skip the grants table too.
   */
  async rebuildAccess(type: string, options: { chunk?: number } = {}): Promise<number> {
    const target = this.#columns[type];
    if (!target) throw new Error(`No access column configured for subject type [${type}].`);
    let after = "";
    let count = 0;
    for (;;) {
      const ids = await this.store.subjectIdsOfType(type, after, options.chunk ?? 500);
      if (ids.length === 0) break;
      for (const id of ids) await this.#writeAccess({ type, id }, target);
      count += ids.length;
      after = ids[ids.length - 1]!;
    }
    await this.store.fillEmptyAccess(target, encodeAccess([]));
    return count;
  }

  async #writeAccess(subject: Subject, target: AccessColumn): Promise<string> {
    const grants = await this.store.allGrantsOf(subject);
    const value = encodeAccess(grants, this.#maxColumnGrants);
    await this.store.writeAccess(target, subject.id, value);
    return value;
  }

  /** Change a subject's grants; keep its access column (if any) in the same transaction, then bump its counter. */
  async #mutate(who: SubjectLike, subject: Subject, change: () => Promise<unknown>): Promise<void> {
    const target = this.#columns[subject.type];
    if (!target) await change();
    else {
      let value = "";
      await this.store.transaction(async () => {
        await change();
        value = await this.#writeAccess(subject, target);
      });
      // The model in hand carries the old column: update it so its next check sees this change.
      const loaded = who as { getAttribute?: unknown; forceFill?: (a: Record<string, unknown>) => unknown; syncOriginal?: () => unknown } & Record<string, unknown>;
      if (typeof loaded.forceFill === "function") {
        loaded.forceFill({ [target.column]: value });
        loaded.syncOriginal?.();
      } else if ("permissionSubject" in who) {
        loaded[target.column] = value;
      }
    }
    await this.#changed([subjectKey(subject)]);
  }

  // --- bulk, claims, warm-up -------------------------------------------------

  /**
   * Give many subjects the same role or permission in one go (chunked inserts; subjects that already
   * hold it are skipped). Returns how many were newly granted.
   */
  async grantMany(
    subjects: SubjectLike[],
    grant: { role: string } | { permission: string },
    scope = GLOBAL_SCOPE,
    options: GrantOptions = {},
  ): Promise<number> {
    const kind = "role" in grant ? GRANT_ROLE : GRANT_PERMISSION;
    const target = "role" in grant ? (await this.#role({ name: grant.role, scope })).id : (await this.#permissionIds([grant.permission]))[0]!;
    const byType = new Map<string, Subject[]>();
    for (const who of subjects) {
      const subject = subjectOf(who);
      (byType.get(subject.type) ?? byType.set(subject.type, []).get(subject.type)!).push(subject);
    }
    const now = Math.floor(this.#now() / 1000);
    const created: Subject[] = [];
    for (const [type, group] of byType) {
      const ids = [...new Set(group.map((subject) => String(subject.id)))];
      await this.store.transaction(async () => {
        const held = await this.store.holders(type, ids, scope, kind, target);
        const missing = ids.filter((id) => !held.has(id));
        if (missing.length > 0) await this.store.insertGrants(type, missing, scope, kind, target, toSeconds(options.expiresAt), now);
        const column = this.#columns[type];
        for (const id of missing) {
          created.push({ type, id });
          if (column) await this.#writeAccess({ type, id }, column);
        }
      });
    }
    await this.#changed(created.map(subjectKey));
    return created.length;
  }

  /** Remove everything a subject holds, in one scope or everywhere. */
  async revokeAll(who: SubjectLike, scope?: string): Promise<void> {
    const subject = subjectOf(who);
    await this.#mutate(who, subject, () => this.store.removeAllGrants(subject, scope));
  }

  /**
   * Grants for a signed token or session: the same compact form as the access column plus the subject
   * counter, so a later grant change makes old claims stop applying (checks then use the database).
   * Attach them on the next request with `withClaims(user, claims)`.
   */
  async issueClaims(who: SubjectLike): Promise<string> {
    const subject = subjectOf(who);
    const [version] = await this.versions.get([subjectKey(subject)]);
    return encodeAccess(await this.store.allGrantsOf(subject), this.#maxColumnGrants, version);
  }

  /** Build role snapshots for scopes ahead of traffic (default: the global scope). */
  async warm(scopes: string[] = [GLOBAL_SCOPE]): Promise<void> {
    await this.#loadRegistry(true);
    for (const scope of scopes) await this.#resolver.warmScope(scope);
  }

  /** Make every process recompute: everything, or one scope and the scopes below it. */
  async clearCache(scope?: string): Promise<void> {
    await this.#changed([scope === undefined ? registryKey : scopeKey(scope)]);
  }

  /** Share one per-request memo between all checks made inside `fn` (the route middleware does this). */
  runRequest<T>(fn: () => T): T {
    return this.#resolver.runRequest(fn);
  }

  // --- queries and tooling ---------------------------------------------------

  /**
   * Subject ids that hold a permission in a scope (or an ancestor), through a role or directly.
   * Super-admin hook results are not included. Capped by `limit`.
   */
  async whoCan(permission: string, scope = GLOBAL_SCOPE, options: { type?: string; limit?: number } = {}): Promise<string[]> {
    await this.#loadRegistry();
    const id = this.registry.idOf(permission);
    if (id === undefined) {
      if (this.#strict) throw new UnknownPermissionError(permission);
      return [];
    }
    const covering = this.#covering(id);
    const chain = await this.scopes.chain(scope);
    const roleIds = await this.store.rolesWithPermissions(chain, covering);
    return this.store.subjectsHolding(options.type ?? "user", chain, roleIds, covering, Math.floor(this.#now() / 1000), options.limit ?? 1000);
  }

  /** Why a check passes or fails. Uncached: for debugging and audit screens. */
  async explain(who: SubjectLike, permission: string, scope?: string): Promise<{
    allowed: boolean;
    superAdmin: boolean;
    via: Array<{ kind: "role" | "permission"; name: string; scope: string }>;
  }> {
    const subject = subjectOf(who);
    scope ??= await this.#defaultScope();
    if (this.#superAdmin && (await this.#superAdmin(subject, scope))) return { allowed: true, superAdmin: true, via: [] };
    await this.#loadRegistry(true);
    const id = this.registry.idOf(permission);
    if (id === undefined) return { allowed: false, superAdmin: false, via: [] };
    const chain = await this.scopes.chain(scope);
    const load = await this.store.loadCold(subject, chain, true, Math.floor(this.#now() / 1000));
    const rolePermissions = new Map<number, ReturnType<typeof emptyBitmap>>();
    for (const row of load.rolePermissions ?? []) {
      rolePermissions.set(row.roleId, orInto(rolePermissions.get(row.roleId) ?? emptyBitmap(), this.registry.bitsFor(row.permissionId)));
    }
    const roles = new Map((load.roles ?? []).map((role) => [role.id, role]));
    const via: Array<{ kind: "role" | "permission"; name: string; scope: string }> = [];
    // Root scope first, roles before direct permissions: the same order on every database.
    const grants = [...load.grants].sort((a, b) => chain.indexOf(a.scope) - chain.indexOf(b.scope) || a.kind - b.kind || a.target - b.target);
    for (const grant of grants) {
      if (grant.kind === GRANT_ROLE) {
        const bits = rolePermissions.get(grant.target);
        if (bits && hasBit(bits, id)) via.push({ kind: "role", name: roles.get(grant.target)?.name ?? String(grant.target), scope: grant.scope });
      } else if (hasBit(this.registry.bitsFor(grant.target), id)) {
        via.push({ kind: "permission", name: this.registry.nameOf(grant.target) ?? String(grant.target), scope: grant.scope });
      }
    }
    return { allowed: via.length > 0, superAdmin: false, via };
  }

  /** Delete expired grants (reads already ignore them). Returns how many were removed. */
  pruneExpired(): Promise<number> {
    return this.store.deleteExpiredGrants(Math.floor(this.#now() / 1000));
  }

  /** Permission names in the table that the code no longer declares (wildcards are never orphans). */
  async orphans(declared: string[]): Promise<string[]> {
    const known = new Set(declared);
    return (await this.store.permissionRows()).map((row) => row.name).filter((name) => !isPattern(name) && !known.has(name)).sort();
  }

  /** Every permission row that grants this one: itself and any wildcard covering it. */
  #covering(id: number): number[] {
    const covering: number[] = [];
    for (const name of [...this.registry.names(), ...this.registry.wildcards()]) {
      const candidate = this.registry.idOf(name);
      if (candidate !== undefined && hasBit(this.registry.bitsFor(candidate), id)) covering.push(candidate);
    }
    return covering;
  }

  /**
   * Limit a query on the subject table to rows that hold a permission (through a role, a wildcard or
   * directly) in the scope or its parents: `await permissions.whereCan(User.query(), 'posts.update', 'team:42', …)`.
   * One indexed `EXISTS`, so it pages and counts like any other condition. The super-admin hook is not applied.
   */
  async whereCan<Q extends WhereRawable>(query: Q, permission: string, scope: string | undefined, target: QueryTarget): Promise<Q> {
    await this.#loadRegistry();
    const id = this.registry.idOf(permission);
    if (id === undefined) {
      if (this.#strict) throw new UnknownPermissionError(permission);
      return query.whereRaw("1 = 0", []) as Q;
    }
    const chain = await this.scopes.chain(scope ?? (await this.#defaultScope()));
    const covering = this.#covering(id);
    const roleIds = await this.store.rolesWithPermissions(chain, covering);
    const condition = this.store.existsCondition(this.#target(target), chain, roleIds, covering, Math.floor(this.#now() / 1000));
    return query.whereRaw(condition.sql, condition.bindings) as Q;
  }

  /** Limit a query on the subject table to rows that hold a role in the scope or its parents. */
  async whereHasRole<Q extends WhereRawable>(query: Q, role: string, scope: string | undefined, target: QueryTarget): Promise<Q> {
    const chain = await this.scopes.chain(scope ?? (await this.#defaultScope()));
    const roleIds = (await this.store.findRoles(chain, role)).map((row) => row.id);
    const condition = this.store.existsCondition(this.#target(target), chain, roleIds, [], Math.floor(this.#now() / 1000));
    return query.whereRaw(condition.sql, condition.bindings) as Q;
  }

  #target(target: QueryTarget): { table: string; key: string; type: string } {
    return { table: target.table, key: target.key ?? "id", type: target.type ?? "user" };
  }

  // --- internals -------------------------------------------------------------

  async #role(ref: RoleRef): Promise<RoleRow> {
    if (typeof ref === "number") {
      const row = await this.store.roleById(ref);
      if (!row) throw new RoleNotFoundError(String(ref), GLOBAL_SCOPE);
      return row;
    }
    const scope = ref.scope ?? GLOBAL_SCOPE;
    const chain = await this.scopes.chain(scope);
    const rows = await this.store.findRoles(chain, ref.name);
    // The nearest scope wins: a tenant role shadows a global template of the same name.
    for (let i = chain.length - 1; i >= 0; i--) {
      const row = rows.find((candidate) => candidate.scope === chain[i]);
      if (row) return row;
    }
    throw new RoleNotFoundError(ref.name, scope);
  }

  /** Resolve names to ids, creating wildcards on the fly and rejecting unknown concrete names. */
  async #permissionIds(names: string[]): Promise<number[]> {
    await this.#loadRegistry();
    const wildcards = names.filter((name) => isPattern(name) && this.registry.idOf(name) === undefined);
    if (wildcards.length > 0) {
      await this.store.insertPermissions(wildcards);
      await this.#changed([registryKey]);
      await this.#loadRegistry(true);
    }
    return names.map((name) => {
      const id = this.registry.idOf(name);
      if (id === undefined) throw new UnknownPermissionError(name);
      return id;
    });
  }

  async #loadRegistry(force = false): Promise<void> {
    if (!force && this.registry.size > 0) return;
    this.registry.load(await this.store.permissionRows());
  }

  async #changed(keys: string[]): Promise<void> {
    for (const key of keys) await this.versions.bump(key);
    this.#resolver.invalidate(keys);
  }
}

let current: Permissions | undefined;

export function setPermissions(permissions: Permissions | undefined): void {
  current = permissions;
}

export function getPermissions(): Permissions {
  if (!current) throw new Error("Permissions is not configured. Call setPermissions(new Permissions({ db })) at boot.");
  return current;
}
