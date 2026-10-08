/** Minimal DB surface, satisfied by the `@bunyad/database` Connection. */
export type PermissionsDb = {
  /** Connection driver name (`sqlite`, `postgres`, `mysql`, …); needed for `whereCan` casts. */
  driver?: string;
  run(sql: string, params?: unknown[]): unknown;
  get<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T | null | Promise<T | null>;
  all<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): T[] | Promise<T[]>;
  transaction?<T>(callback: () => T | Promise<T>): Promise<T>;
};

/** Anything that holds grants: a user, a service account, an API token. */
export type Subject = {
  type: string;
  id: string | number;
  /** The subject row's access column, when the app loaded it (`column` grant source). */
  access?: string | null;
};

/** Objects that can describe themselves as a subject (`HasPermissions` models). */
export type SubjectLike = Subject | { permissionSubject(): Subject };

/** Shared counters used to validate cached entries without scanning keys. */
export interface VersionStore {
  get(keys: string[]): Promise<number[]>;
  bump(key: string): Promise<number>;
}

/** Optional shared cache for snapshots and effective sets (a Bunyad cache repository fits). */
export interface SharedCache {
  get(key: string): Promise<unknown> | unknown;
  put(key: string, value: unknown, ttlSeconds?: number): Promise<unknown> | unknown;
}

export type RoleRef = number | { name: string; scope?: string };

export type GrantKind = 1 | 2;
/** `grants.kind` values. */
export const GRANT_ROLE: GrantKind = 1;
export const GRANT_PERMISSION: GrantKind = 2;

export class PermissionsError extends Error {}
export class UnknownPermissionError extends PermissionsError {
  constructor(readonly permission: string) {
    super(`Unknown permission [${permission}]. Declare it with definePermissions() and run permissions:sync.`);
  }
}
export class RoleNotFoundError extends PermissionsError {
  constructor(name: string, scope: string) {
    super(`Role [${name}] not found in scope [${scope}] or its parents.`);
  }
}
