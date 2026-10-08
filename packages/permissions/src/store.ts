import { GRANT_PERMISSION, GRANT_ROLE, type GrantKind, type PermissionsDb, type Subject } from "./types.ts";

export type GrantRow = { kind: GrantKind; target: number; scope: string; expiresAt: number | null };
export type RoleRow = { id: number; scope: string; name: string };
export type RolePermissionRow = { roleId: number; permissionId: number };

export type ColdLoad = {
  grants: GrantRow[];
  /** Every role in the chain scopes (also roles without permissions); present when requested. */
  roles?: RoleRow[];
  rolePermissions?: RolePermissionRow[];
};

const CHUNK = 200;
const placeholders = (count: number): string => Array.from({ length: count }, () => "?").join(",");

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PermissionTables = { permissions: string; roles: string; role_permissions: string; grants: string };
export const DEFAULT_TABLES: PermissionTables = {
  permissions: "permissions",
  roles: "roles",
  role_permissions: "role_permissions",
  grants: "grants",
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Point the store at differently named tables: every statement is written against the default names. */
function renamed(db: PermissionsDb, overrides: Partial<PermissionTables> | undefined): PermissionsDb {
  const tables = { ...DEFAULT_TABLES, ...overrides };
  for (const name of Object.values(tables)) {
    if (!IDENTIFIER.test(name)) throw new Error(`Invalid table name [${name}] in the permissions config.`);
  }
  if (Object.keys(DEFAULT_TABLES).every((key) => tables[key as keyof PermissionTables] === DEFAULT_TABLES[key as keyof PermissionTables])) {
    return db;
  }
  const pattern = /\b(FROM|JOIN|INTO|UPDATE)\s+(grants|roles|role_permissions|permissions)\b/g;
  const rewrite = (sql: string) => sql.replace(pattern, (_, verb: string, name: string) => `${verb} ${tables[name as keyof PermissionTables]}`);
  return {
    driver: db.driver,
    run: (sql, params) => db.run(rewrite(sql), params),
    get: (sql, params) => db.get(rewrite(sql), params),
    all: (sql, params) => db.all(rewrite(sql), params),
    transaction: db.transaction ? (fn) => db.transaction!(fn) : undefined,
  };
}

/** All SQL lives here. Plain `?` placeholders and portable types, no engine-specific syntax. */
export class PermissionStore {
  private readonly db: PermissionsDb;
  readonly tables: PermissionTables;

  constructor(db: PermissionsDb, tables?: Partial<PermissionTables>) {
    this.db = renamed(db, tables);
    this.tables = { ...DEFAULT_TABLES, ...tables };
  }

  get driver(): string {
    return this.db.driver ?? "sqlite";
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.transaction ? this.db.transaction(fn) : fn();
  }

  // --- reads on the hot path -------------------------------------------------

  /**
   * One statement for a cold subject: the subject's grants plus (when `withRoles`)
   * every role of the chain scopes with its permission ids.
   */
  async loadCold(subject: Subject, chain: string[], withRoles: boolean, nowSeconds: number): Promise<ColdLoad> {
    const scopes = placeholders(chain.length);
    const grantSql =
      `SELECT 'g' AS k, g.kind AS a, g.target_id AS b, g.scope AS s, COALESCE(g.expires_at, 0) AS e, '' AS n FROM grants g ` +
      `WHERE g.subject_type = ? AND g.subject_id = ? AND g.scope IN (${scopes}) ` +
      `AND (g.expires_at IS NULL OR g.expires_at > ?)`;
    const grantParams = [subject.type, String(subject.id), ...chain, nowSeconds];

    let sql = grantSql;
    let params = grantParams;
    if (withRoles) {
      sql +=
        ` UNION ALL SELECT 'r', r.id, COALESCE(rp.permission_id, 0), r.scope, 0, r.name FROM roles r ` +
        `LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE r.scope IN (${scopes})`;
      params = [...grantParams, ...chain];
    }
    const rows = await this.db.all<Record<string, unknown>>(sql, params);

    const load: ColdLoad = { grants: [] };
    if (withRoles) {
      load.roles = [];
      load.rolePermissions = [];
    }
    const seenRoles = new Set<number>();
    for (const row of rows) {
      if (row.k === "g") {
        const expires = Number(row.e);
        load.grants.push({
          kind: Number(row.a) as GrantKind,
          target: Number(row.b),
          scope: String(row.s),
          expiresAt: expires === 0 ? null : expires,
        });
      } else {
        const roleId = Number(row.a);
        if (!seenRoles.has(roleId)) {
          seenRoles.add(roleId);
          load.roles!.push({ id: roleId, scope: String(row.s), name: String(row.n) });
        }
        const permissionId = Number(row.b);
        if (permissionId > 0) load.rolePermissions!.push({ roleId, permissionId });
      }
    }
    return load;
  }

  /** Roles of the chain scopes with their permission ids, without any grants (the `column` source). */
  async loadRoles(chain: string[]): Promise<ColdLoad> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT r.id AS a, COALESCE(rp.permission_id, 0) AS b, r.scope AS s, r.name AS n FROM roles r ` +
        `LEFT JOIN role_permissions rp ON rp.role_id = r.id WHERE r.scope IN (${placeholders(chain.length)})`,
      chain,
    );
    const load: ColdLoad = { grants: [], roles: [], rolePermissions: [] };
    const seen = new Set<number>();
    for (const row of rows) {
      const roleId = Number(row.a);
      if (!seen.has(roleId)) {
        seen.add(roleId);
        load.roles!.push({ id: roleId, scope: String(row.s), name: String(row.n) });
      }
      if (Number(row.b) > 0) load.rolePermissions!.push({ roleId, permissionId: Number(row.b) });
    }
    return load;
  }

  /** Every grant of a subject, all scopes (rebuilding its access column). */
  async allGrantsOf(subject: Subject): Promise<GrantRow[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      "SELECT scope, kind, target_id, expires_at FROM grants WHERE subject_type = ? AND subject_id = ? ORDER BY scope, kind, target_id",
      [subject.type, String(subject.id)],
    );
    return rows.map((row) => ({
      scope: String(row.scope),
      kind: Number(row.kind) as GrantKind,
      target: Number(row.target_id),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    }));
  }

  async subjectsWithRole(roleId: number): Promise<Subject[]> {
    const rows = await this.db.all<{ subject_type: string; subject_id: string }>(
      "SELECT DISTINCT subject_type, subject_id FROM grants WHERE kind = ? AND target_id = ?",
      [GRANT_ROLE, roleId],
    );
    return rows.map((row) => ({ type: String(row.subject_type), id: String(row.subject_id) }));
  }

  async subjectIdsOfType(type: string, after: string, limit: number): Promise<string[]> {
    const rows = await this.db.all<{ subject_id: string }>(
      "SELECT DISTINCT subject_id FROM grants WHERE subject_type = ? AND subject_id > ? ORDER BY subject_id LIMIT ?",
      [type, after, limit],
    );
    return rows.map((row) => String(row.subject_id));
  }

  async writeAccess(target: { table: string; column: string; key?: string }, id: string | number, value: string): Promise<void> {
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const key = target.key ?? "id";
    for (const part of [target.table, target.column, key]) {
      if (!ident.test(part)) throw new Error(`Invalid identifier [${part}] in the access column config.`);
    }
    await this.db.run(`UPDATE ${target.table} SET ${target.column} = ? WHERE ${key} = ?`, [value, id]);
  }

  async removeAllGrants(subject: Subject, scope?: string): Promise<void> {
    if (scope === undefined) {
      await this.db.run("DELETE FROM grants WHERE subject_type = ? AND subject_id = ?", [subject.type, String(subject.id)]);
    } else {
      await this.db.run("DELETE FROM grants WHERE subject_type = ? AND subject_id = ? AND scope = ?", [subject.type, String(subject.id), scope]);
    }
  }

  /** Which of these subject ids already hold the grant. */
  async holders(type: string, ids: string[], scope: string, kind: GrantKind, target: number): Promise<Set<string>> {
    const held = new Set<string>();
    for (const part of chunks(ids)) {
      const rows = await this.db.all<{ subject_id: string }>(
        `SELECT subject_id FROM grants WHERE subject_type = ? AND scope = ? AND kind = ? AND target_id = ? AND subject_id IN (${placeholders(part.length)})`,
        [type, scope, kind, target, ...part],
      );
      for (const row of rows) held.add(String(row.subject_id));
    }
    return held;
  }

  async insertGrants(type: string, ids: string[], scope: string, kind: GrantKind, target: number, expiresAt: number | null, nowSeconds: number): Promise<void> {
    for (const part of chunks(ids)) {
      await this.db.run(
        `INSERT INTO grants (subject_type, subject_id, scope, kind, target_id, expires_at, created_at) VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",")}`,
        part.flatMap((id) => [type, id, scope, kind, target, expiresAt, nowSeconds]),
      );
    }
  }

  /**
   * An `EXISTS (...)` condition for a query on the subject table: rows whose subject holds one of the
   * roles or permissions in the scopes. The id column is cast so integer and text keys both match.
   */
  existsCondition(
    subject: { table: string; key: string; type: string },
    scopes: string[],
    roleIds: number[],
    permissionIds: number[],
    nowSeconds: number,
  ): { sql: string; bindings: unknown[] } {
    const targets: string[] = [];
    const bindings: unknown[] = [subject.type, ...scopes];
    if (roleIds.length > 0) {
      targets.push(`(g.kind = ${GRANT_ROLE} AND g.target_id IN (${placeholders(roleIds.length)}))`);
      bindings.push(...roleIds);
    }
    if (permissionIds.length > 0) {
      targets.push(`(g.kind = ${GRANT_PERMISSION} AND g.target_id IN (${placeholders(permissionIds.length)}))`);
      bindings.push(...permissionIds);
    }
    if (targets.length === 0) return { sql: "1 = 0", bindings: [] };
    bindings.push(nowSeconds);
    for (const part of [subject.table, subject.key]) {
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(part)) throw new Error(`Invalid identifier [${part}] in whereCan.`);
    }
    // MySQL: an explicit collation on the cast side avoids "illegal mix of collations" with the table's own.
    const mysql = this.driver === "mysql" || this.driver === "mariadb";
    const cast = this.driver === "sqlite" ? "TEXT" : mysql ? "CHAR(40)" : "VARCHAR(40)";
    const collate = mysql ? " COLLATE utf8mb4_bin" : "";
    const sql =
      `EXISTS (SELECT 1 FROM ${this.tables.grants} g WHERE g.subject_type = ? AND g.scope IN (${placeholders(scopes.length)}) ` +
      `AND (${targets.join(" OR ")}) AND (g.expires_at IS NULL OR g.expires_at > ?) ` +
      `AND g.subject_id = CAST(${subject.table}.${subject.key} AS ${cast})${collate})`;
    return { sql, bindings };
  }

  /** Give subjects that have no grants (NULL column) an explicit empty value. */
  async fillEmptyAccess(target: { table: string; column: string }, empty: string): Promise<void> {
    const ident = /^[A-Za-z_][A-Za-z0-9_]*$/;
    for (const part of [target.table, target.column]) {
      if (!ident.test(part)) throw new Error(`Invalid identifier [${part}] in the access column config.`);
    }
    await this.db.run(`UPDATE ${target.table} SET ${target.column} = ? WHERE ${target.column} IS NULL`, [empty]);
  }

  // --- registry --------------------------------------------------------------

  async permissionRows(): Promise<Array<{ id: number; name: string }>> {
    const rows = await this.db.all<{ id: number; name: string }>("SELECT id, name FROM permissions");
    return rows.map((row) => ({ id: Number(row.id), name: String(row.name) }));
  }

  async insertPermissions(names: string[]): Promise<void> {
    if (names.length === 0) return;
    const existing = new Set((await this.permissionRows()).map((row) => row.name));
    for (const name of names) {
      if (existing.has(name)) continue;
      try {
        await this.db.run("INSERT INTO permissions (name) VALUES (?)", [name]);
      } catch (error) {
        // A parallel sync inserted it first: fine.
        if (!/unique|duplicate/i.test(String((error as Error).message))) throw error;
      }
    }
  }

  // --- roles -----------------------------------------------------------------

  async findRoles(scopes: string[], name?: string): Promise<RoleRow[]> {
    const where = [`scope IN (${placeholders(scopes.length)})`];
    const params: unknown[] = [...scopes];
    if (name !== undefined) {
      where.push("name = ?");
      params.push(name);
    }
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT id, scope, name FROM roles WHERE ${where.join(" AND ")}`,
      params,
    );
    return rows.map((row) => ({ id: Number(row.id), scope: String(row.scope), name: String(row.name) }));
  }

  async roleById(id: number): Promise<RoleRow | null> {
    const row = await this.db.get<Record<string, unknown>>("SELECT id, scope, name FROM roles WHERE id = ?", [id]);
    return row ? { id: Number(row.id), scope: String(row.scope), name: String(row.name) } : null;
  }

  async insertRole(scope: string, name: string, isSystem: boolean, now: string): Promise<number> {
    await this.db.run("INSERT INTO roles (scope, name, is_system, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      scope,
      name,
      isSystem ? 1 : 0,
      now,
      now,
    ]);
    const row = await this.db.get<{ id: number }>("SELECT id FROM roles WHERE scope = ? AND name = ?", [scope, name]);
    return Number(row!.id);
  }

  /** Permission ids of many roles in one statement. */
  async rolePermissionsOf(roleIds: number[]): Promise<RolePermissionRow[]> {
    const out: RolePermissionRow[] = [];
    for (const part of chunks(roleIds)) {
      const rows = await this.db.all<{ role_id: number; permission_id: number }>(
        `SELECT role_id, permission_id FROM role_permissions WHERE role_id IN (${placeholders(part.length)})`,
        part,
      );
      for (const row of rows) out.push({ roleId: Number(row.role_id), permissionId: Number(row.permission_id) });
    }
    return out;
  }

  /** Insert many roles in one statement per chunk (names must not exist in the scope yet). */
  async insertRoles(scope: string, names: string[], now: string): Promise<void> {
    for (const part of chunks(names)) {
      await this.db.run(
        `INSERT INTO roles (scope, name, is_system, created_at, updated_at) VALUES ${part.map(() => "(?, ?, 0, ?, ?)").join(",")}`,
        part.flatMap((name) => [scope, name, now, now]),
      );
    }
  }

  async addRolePermissionPairs(pairs: RolePermissionRow[]): Promise<void> {
    for (const part of chunks(pairs)) {
      await this.db.run(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ${part.map(() => "(?, ?)").join(",")}`,
        part.flatMap((pair) => [pair.roleId, pair.permissionId]),
      );
    }
  }

  async rolePermissionIds(roleId: number): Promise<number[]> {
    const rows = await this.db.all<{ permission_id: number }>(
      "SELECT permission_id FROM role_permissions WHERE role_id = ?",
      [roleId],
    );
    return rows.map((row) => Number(row.permission_id));
  }

  async addRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
    for (const part of chunks(permissionIds)) {
      const values = part.map(() => "(?, ?)").join(",");
      await this.db.run(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ${values}`,
        part.flatMap((id) => [roleId, id]),
      );
    }
  }

  async removeRolePermissions(roleId: number, permissionIds: number[]): Promise<void> {
    for (const part of chunks(permissionIds)) {
      await this.db.run(
        `DELETE FROM role_permissions WHERE role_id = ? AND permission_id IN (${placeholders(part.length)})`,
        [roleId, ...part],
      );
    }
  }

  async deleteRole(roleId: number): Promise<void> {
    await this.db.run("DELETE FROM grants WHERE kind = ? AND target_id = ?", [GRANT_ROLE, roleId]);
    await this.db.run("DELETE FROM role_permissions WHERE role_id = ?", [roleId]);
    await this.db.run("DELETE FROM roles WHERE id = ?", [roleId]);
  }

  // --- grants ----------------------------------------------------------------

  async grantsOf(subject: Subject, scope: string, kind: GrantKind): Promise<Array<{ target: number; expiresAt: number | null }>> {
    const rows = await this.db.all<Record<string, unknown>>(
      "SELECT target_id, expires_at FROM grants WHERE subject_type = ? AND subject_id = ? AND scope = ? AND kind = ?",
      [subject.type, String(subject.id), scope, kind],
    );
    return rows.map((row) => ({
      target: Number(row.target_id),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    }));
  }

  /** Idempotent: inserts, or refreshes the expiry of an existing grant. Returns true when created. */
  async upsertGrant(subject: Subject, scope: string, kind: GrantKind, target: number, expiresAt: number | null, nowSeconds: number): Promise<boolean> {
    const key = [subject.type, String(subject.id), scope, kind, target];
    const existing = await this.db.get(
      "SELECT 1 AS present FROM grants WHERE subject_type = ? AND subject_id = ? AND scope = ? AND kind = ? AND target_id = ?",
      key,
    );
    if (existing) {
      await this.db.run(
        "UPDATE grants SET expires_at = ? WHERE subject_type = ? AND subject_id = ? AND scope = ? AND kind = ? AND target_id = ?",
        [expiresAt, ...key],
      );
      return false;
    }
    try {
      await this.db.run(
        "INSERT INTO grants (subject_type, subject_id, scope, kind, target_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [...key, expiresAt, nowSeconds],
      );
      return true;
    } catch (error) {
      if (!/unique|duplicate|constraint/i.test(String((error as Error).message))) throw error;
      return false;
    }
  }

  async removeGrants(subject: Subject, scope: string, kind: GrantKind, targets: number[]): Promise<void> {
    for (const part of chunks(targets)) {
      await this.db.run(
        `DELETE FROM grants WHERE subject_type = ? AND subject_id = ? AND scope = ? AND kind = ? AND target_id IN (${placeholders(part.length)})`,
        [subject.type, String(subject.id), scope, kind, ...part],
      );
    }
  }

  /** Role ids in the given scopes that hold any of the permission ids. */
  async rolesWithPermissions(scopes: string[], permissionIds: number[]): Promise<number[]> {
    if (permissionIds.length === 0) return [];
    const rows = await this.db.all<{ role_id: number }>(
      `SELECT DISTINCT rp.role_id FROM role_permissions rp JOIN roles r ON r.id = rp.role_id ` +
        `WHERE r.scope IN (${placeholders(scopes.length)}) AND rp.permission_id IN (${placeholders(permissionIds.length)})`,
      [...scopes, ...permissionIds],
    );
    return rows.map((row) => Number(row.role_id));
  }

  /** Subject ids holding any of the roles or permissions in the scopes, newest grants not required. */
  async subjectsHolding(
    type: string,
    scopes: string[],
    roleIds: number[],
    permissionIds: number[],
    nowSeconds: number,
    limit: number,
  ): Promise<string[]> {
    const targets: string[] = [];
    const params: unknown[] = [type, ...scopes];
    if (roleIds.length > 0) {
      targets.push(`(kind = ${GRANT_ROLE} AND target_id IN (${placeholders(roleIds.length)}))`);
      params.push(...roleIds);
    }
    if (permissionIds.length > 0) {
      targets.push(`(kind = ${GRANT_PERMISSION} AND target_id IN (${placeholders(permissionIds.length)}))`);
      params.push(...permissionIds);
    }
    if (targets.length === 0) return [];
    params.push(nowSeconds, limit);
    const rows = await this.db.all<{ subject_id: string }>(
      `SELECT DISTINCT subject_id FROM grants WHERE subject_type = ? AND scope IN (${placeholders(scopes.length)}) ` +
        `AND (${targets.join(" OR ")}) AND (expires_at IS NULL OR expires_at > ?) ORDER BY subject_id LIMIT ?`,
      params,
    );
    return rows.map((row) => String(row.subject_id));
  }

  async deleteExpiredGrants(nowSeconds: number): Promise<number> {
    return Number(await this.db.run("DELETE FROM grants WHERE expires_at IS NOT NULL AND expires_at <= ?", [nowSeconds])) || 0;
  }

  /** Grants whose role or permission no longer exists. */
  async danglingGrantCount(): Promise<{ roles: number; permissions: number }> {
    const count = async (sql: string): Promise<number> => Number((await this.db.get<{ n: number }>(sql))?.n ?? 0);
    return {
      roles: await count(
        `SELECT COUNT(*) AS n FROM grants g WHERE g.kind = ${GRANT_ROLE} AND NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = g.target_id)`,
      ),
      permissions: await count(
        `SELECT COUNT(*) AS n FROM grants g WHERE g.kind = ${GRANT_PERMISSION} AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.id = g.target_id)`,
      ),
    };
  }

  /** Subject ids holding a role or permission in a scope (admin screens). */
  async subjectsWithTarget(type: string, scope: string, kind: GrantKind, targets: number[], nowSeconds: number): Promise<string[]> {
    const rows = await this.db.all<{ subject_id: string }>(
      `SELECT DISTINCT subject_id FROM grants WHERE subject_type = ? AND scope = ? AND kind = ? AND target_id IN (${placeholders(targets.length)}) AND (expires_at IS NULL OR expires_at > ?)`,
      [type, scope, kind, ...targets, nowSeconds],
    );
    return rows.map((row) => String(row.subject_id));
  }
}

export { GRANT_PERMISSION, GRANT_ROLE };
