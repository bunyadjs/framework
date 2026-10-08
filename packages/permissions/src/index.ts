export { type Bitmap, bitmapFromBase64, bitmapIds, bitmapToBase64, emptyBitmap, hasBit, orInto, setBit } from "./bitmap.ts";
export { type PermissionDefinitions, PermissionRegistry, definePermissions, isPattern, patternCovers } from "./registry.ts";
export { GLOBAL_SCOPE, ScopeTree, type ScopeParentResolver, scopeId, scopeOf, scopeType } from "./scope.ts";
export { CacheVersionStore, type CounterCache, MemoryVersionStore } from "./versions.ts";
export { DEFAULT_TABLES, PermissionStore, type PermissionTables } from "./store.ts";
export { PUBLISH_TAGS, stubPath } from "./stubs.ts";
export { PermissionResolver, type EffectiveSet } from "./resolver.ts";
export {
  Permissions,
  type GrantOptions,
  type PermissionsOptions,
  type SyncResult,
  getPermissions,
  setPermissions,
  subjectOf,
  withClaims,
  type QueryTarget,
  type WhereRawable,
} from "./manager.ts";
export { addAccessColumn, createPermissionTables, dropPermissionTables } from "./migration.ts";
export { type AccessColumn, encodeAccess, hashAccess, parseAccess } from "./access.ts";
export {
  GRANT_PERMISSION,
  GRANT_ROLE,
  PermissionsError,
  RoleNotFoundError,
  UnknownPermissionError,
  type GrantKind,
  type PermissionsDb,
  type RoleRef,
  type SharedCache,
  type Subject,
  type SubjectLike,
  type VersionStore,
} from "./types.ts";
export {
  HasPermissions,
  subjectFromUser,
  type HasPermissionsOptions,
  type PermissionMethods,
  type PermissionStatics,
} from "./has-permissions.ts";
export { loadPermissions, permission, permissionAny, registerPermissionMiddleware, role } from "./middleware.ts";
export { installPermissionGate } from "./gate.ts";
export { registerPermissionCommands, unknownPermissionsInRoutes, type PermissionCommandOptions } from "./commands.ts";
