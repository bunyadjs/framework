import { type Permissions, type GrantOptions, type SyncResult, getPermissions, subjectOf } from "./manager.ts";
import type { Subject } from "./types.ts";

/** Methods `HasPermissions` adds to a subject model. Declare them with `interface User extends PermissionMethods {}`. */
export interface PermissionMethods {
  permissionSubject(): Subject;
  can(permission: string, scope?: string): Promise<boolean>;
  canAny(permissions: string[], scope?: string): Promise<boolean>;
  canAll(permissions: string[], scope?: string): Promise<boolean>;
  hasRole(role: string, scope?: string): Promise<boolean>;
  permissionNames(scope?: string): Promise<string[]>;
  grantRole(role: string, scope?: string, options?: GrantOptions): Promise<void>;
  revokeRole(role: string, scope?: string): Promise<void>;
  syncRoles(roles: string[], scope?: string): Promise<SyncResult>;
  grantPermission(permission: string, scope?: string, options?: GrantOptions): Promise<void>;
  revokePermission(permission: string, scope?: string): Promise<void>;
}

/** Static helpers added to the model class. Both resolve ids first, so they are awaited and return the query. */
export interface PermissionStatics {
  /** Rows that hold a permission in the scope (or its parents): `(await User.whereCan('posts.update', 'team:42')).paginate(20)`. */
  whereCan(permission: string, scope?: string): Promise<any>;
  /** Rows that hold a role in the scope (or its parents). */
  whereHasRole(role: string, scope?: string): Promise<any>;
}

export type HasPermissionsOptions = {
  /** Subject type stored in grants. Defaults to the lower-cased class name (`User` -> `user`). */
  type?: string;
  permissions?: () => Permissions;
};

function methods(type: string | undefined, get: () => Permissions): PermissionMethods {
  return {
    permissionSubject() {
      const self = this as unknown as { id: string | number; constructor: { name: string } };
      const subject: Subject = { type: type ?? self.constructor.name.toLowerCase(), id: self.id };
      return withAccess(subject, self, get);
    },
    can(permission, scope) {
      return get().can(this as never, permission, scope);
    },
    canAny(permissions, scope) {
      return get().canAny(this as never, permissions, scope);
    },
    canAll(permissions, scope) {
      return get().canAll(this as never, permissions, scope);
    },
    hasRole(role, scope) {
      return get().hasRole(this as never, role, scope);
    },
    permissionNames(scope) {
      return get().permissionNames(this as never, scope);
    },
    grantRole(role, scope, options) {
      return get().grantRole(this as never, role, scope, options);
    },
    revokeRole(role, scope) {
      return get().revokeRole(this as never, role, scope);
    },
    syncRoles(roles, scope) {
      return get().syncRoles(this as never, roles, scope);
    },
    grantPermission(permission, scope, options) {
      return get().grantPermission(this as never, permission, scope, options);
    },
    revokePermission(permission, scope) {
      return get().revokePermission(this as never, permission, scope);
    },
  } as PermissionMethods;
}

/**
 * Adds permission and role methods to a user model, delegating to `Permissions`.
 *
 * As a decorator (declare the types with `interface User extends PermissionMethods {}`):
 *
 * ```ts
 * @HasPermissions()
 * export default class User extends Model {}
 * export default interface User extends PermissionMethods {}
 * ```
 *
 * As a mixin (typed automatically): `class User extends HasPermissions(Model) {}`.
 */
export function HasPermissions(options?: HasPermissionsOptions): ClassDecorator;
export function HasPermissions<TBase extends new (...args: any[]) => object>(
  Base: TBase,
  options?: HasPermissionsOptions,
): TBase & PermissionStatics & (new (...args: any[]) => PermissionMethods);
export function HasPermissions(
  baseOrOptions?: HasPermissionsOptions | (new (...args: any[]) => object),
  maybeOptions?: HasPermissionsOptions,
): unknown {
  if (typeof baseOrOptions === "function") {
    const Base = baseOrOptions;
    const options = maybeOptions ?? {};
    class HasPermissionsHost extends Base {}
    const get = options.permissions ?? getPermissions;
    install(HasPermissionsHost, methods(options.type, get));
    installStatics(HasPermissionsHost, options.type, get);
    return HasPermissionsHost;
  }
  const options = baseOrOptions ?? {};
  const get = options.permissions ?? getPermissions;
  const set = methods(options.type, get);
  return (target: Function) => {
    install(target, set);
    installStatics(target, options.type, get);
  };
}

/** Methods go on the prototype, so they never show up as model attributes. */
function install(target: Function, set: PermissionMethods): void {
  for (const [name, method] of Object.entries(set)) {
    Object.defineProperty(target.prototype, name, { value: method, configurable: true, writable: true });
  }
}

function installStatics(target: Function, type: string | undefined, get: () => Permissions): void {
  const model = target as unknown as { query(): unknown; table: string; primaryKey?: string; name: string };
  const aim = () => ({ table: model.table, key: model.primaryKey ?? "id", type: type ?? model.name.toLowerCase() });
  Object.defineProperty(target, "whereCan", {
    value: (permission: string, scope?: string) => get().whereCan(model.query() as never, permission, scope, aim()),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(target, "whereHasRole", {
    value: (role: string, scope?: string) => get().whereHasRole(model.query() as never, role, scope, aim()),
    configurable: true,
    writable: true,
  });
}

/** The subject for any authenticated user object: the model's own description, else `{ type, id }`. */
export function subjectFromUser(user: { id: string | number }, fallbackType = "user"): Subject {
  const described = user as { permissionSubject?: () => Subject };
  if (typeof described.permissionSubject === "function") return described.permissionSubject();
  return withAccess(subjectOf({ type: fallbackType, id: user.id }), user);
}

/** Attach the loaded access column (`column` grant source) to a subject, when one is configured for its type. */
export function withAccess(subject: Subject, user: object, get: () => Permissions = getPermissions): Subject {
  let column: string | undefined;
  try {
    column = get().accessColumnFor(subject.type);
  } catch {
    return subject;
  }
  if (!column) return subject;
  const row = user as { getAttribute?: (name: string) => unknown } & Record<string, unknown>;
  const raw = typeof row.getAttribute === "function" ? row.getAttribute(column) : row[column];
  if (raw === undefined) return subject; // not loaded: use the grants table
  subject.access = raw === null ? null : typeof raw === "string" ? raw : JSON.stringify(raw);
  return subject;
}
