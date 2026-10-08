---
title: Roles and Permissions
description: Roles, permissions, teams and tenants with @bunyad/permissions - published migrations, route middleware, view directives and fast cached checks.
---

# Roles and Permissions

## Introduction

[Authorization](/docs/1.x/authorization) decides what one user may do with one record. `@bunyad/permissions` answers the broader question: what is this user allowed to do in this team or tenant? You give users **roles** (`editor`, `admin`) and **permissions** (`posts.update`), and you check them in routes, controllers and views.

It is built for apps with many users and many tenants. A check is a bit test in memory. A warm check runs no queries, and a cold one runs a single statement.

```ts
import { Permissions, HasPermissions, definePermissions } from "@bunyad/permissions";
```

`@bunyad/framework` re-exports the common pieces.

## Setup

Publish the migration and the config file, then migrate and sync the permission names:

```bash
bunyad publish --tag=permissions-migrations
bunyad publish --tag=permissions-config
bunyad migrate
bunyad permissions:sync
```

The published files are yours. The migration creates four tables:

| Table | Holds |
|---|---|
| `permissions` | Declared permission names. Wildcards such as `posts.*` are rows too. |
| `roles` | A named bundle of permissions, per scope. |
| `role_permissions` | Which permissions a role holds. |
| `grants` | What a user (or token, or service account) holds, per scope. |

The package stays off until `config/permissions.ts` exists:

```ts title="config/permissions.ts"
import { definePermissions } from "@bunyad/permissions";

export const permissions = definePermissions({
  posts: ["view", "create", "update", "delete"],
  invoices: ["view", "void"],
});

export default {
  declared: permissions,
  defaultScope: () => currentTenantScope(), // for example "tenant:7"
  superAdmin: (subject) => subject.id === 1,
};
```

Run `bunyad permissions:sync` after you add or rename a permission. It never deletes names that are still in use, and it lists names the code no longer declares.

## Scopes: teams and tenants

Every role and every grant belongs to a **scope**: `*` for the whole app, `tenant:7`, `team:42`, or anything you choose. A check in a scope also counts roles and grants in its parents, so a tenant admin can act inside the tenant's teams. Tell the package how scopes nest:

```ts title="config/permissions.ts"
export default {
  scopes: {
    team: { parent: (id) => `tenant:${tenantOfTeam(id)}` },
  },
};
```

Nothing is allowed by default. A role in `team:42` never reaches `team:43`.

## Roles and grants

```ts
const permissions = getPermissions();

await permissions.createRole("editor", "tenant:7");
await permissions.givePermissions({ name: "editor", scope: "tenant:7" }, ["posts.view", "posts.update"]);
await permissions.syncPermissions({ name: "editor", scope: "tenant:7" }, ["posts.*"]);

// Onboarding: copy the global roles into a new tenant (a few statements, safe to repeat).
await permissions.copyRoles("*", "tenant:9");
```

Add the mixin to your user model:

```ts title="app/Models/User.ts"
import { HasPermissions, type PermissionMethods, type PermissionStatics } from "@bunyad/permissions";

@HasPermissions()
export default class User extends Model {}
export default interface User extends PermissionMethods {}
```

Then:

```ts
await user.grantRole("editor", "tenant:7");
await user.grantPermission("invoices.void", "team:42", { expiresAt: new Date("2027-01-01") });
await user.syncRoles(["editor", "viewer"], "tenant:7"); // { attached, detached }
await user.revokeRole("viewer", "tenant:7");

await user.can("posts.update", "team:42");   // true when held in team:42 or its parents
await user.hasRole("editor", "tenant:7");
await user.permissionNames("tenant:7");      // for building a UI
```

Expired grants stop working on their own; `bunyad permissions:prune` deletes them.

To give many users the same role at once, use `grantMany`. It skips users who already have it and inserts in chunks:

```ts
await permissions.grantMany(users, { role: "editor" }, "tenant:7");
await permissions.revokeAll(user, "tenant:7");
```

## Routes

The middleware aliases are registered for you:

```ts title="routes/web.ts"
Route.get("/posts", index).middleware("permission:posts.view");
Route.delete("/posts/:id", destroy).middleware("permission:posts.delete,posts.view"); // needs all
Route.get("/billing", show).middleware("permission.any:invoices.view,settings.manage");
Route.get("/admin", admin).middleware("role:admin");
```

A scope can come from the URL. Names in braces are filled from the route parameters:

```ts
Route.put("/teams/:team/posts/:id", update).middleware("permission:posts.update@team:{team}");
```

An unauthenticated visitor gets `401` and a user without the permission gets `403`. An API token can only narrow its owner: it needs the ability as well as the permission.

Run `bunyad permissions:check-routes` in CI. It reports permissions named in route middleware that the app never declared.

## Views

`@can` and `@cannot` work with permissions, roles and scopes:

```html
@can('posts.update')
  <a href="/posts/{{ post.id }}/edit">Edit</a>
@endcan

@can('role:admin')
  <a href="/admin">Admin</a>
@endcan

@can('posts.update', 'team:42')
  ...
@endcan
```

Views cannot wait for the database, so the answer must already be in memory. Add the `permissions.load` middleware to routes that render these directives (any earlier permission check also works). Until a user is loaded, the directive says no. Policies still decide model-based checks such as `@can('update', post)`.

```ts
Route.middleware("auth", "permissions.load").group(() => {
  // pages that use @can
});
```

## Lists of users

`whereCan` and `whereHasRole` limit a query to users who hold a permission or role in a scope. They are a single indexed `EXISTS`, so paging and counts work:

```ts
const editors = await (await User.whereCan("posts.update", "team:42")).orderBy("name").paginate(20);
const admins = await (await User.whereHasRole("admin", "tenant:7")).count();
```

`permissions.whoCan("posts.update", "team:42")` returns the user ids, and `permissions.explain(user, "posts.update", "team:42")` says which role or grant allowed the check.

## Customizing

| What | How |
|---|---|
| Table names | `tables: { roles: "acl_roles" }` in the config, and the same names in the published migration |
| Columns and types | Edit the published migration (keep the column names) |
| Current scope | `defaultScope: () => "tenant:7"` |
| Who can do everything | `superAdmin: (subject, scope) => boolean` |
| Cache store | `cache: "redis"`, or `false` for in-process only |
| Freshness | `consistency: "eventual"` (memory is trusted for `ttl` seconds) or `"strict"` |
| Subject types | `HasPermissions({ type: "account" })`; tokens and service accounts are subjects too |
| Turn parts off | `gate: false`, `middleware: false`, `commands: false` |

With more than one server, point `cache` at a shared store (Redis). The package keeps small version counters there, so a change made on one server is seen by the others without clearing anything.

## Performance options

**Grants on the user row.** Add the optional column, point the config at it, and a loaded user needs no grants query at all:

```ts title="config/permissions.ts"
export default {
  columns: { user: { table: "users", column: "permission_access" } },
};
```

```bash
bunyad migrate                       # runs the published add-column migration
bunyad permissions:rebuild user      # fills the column from the grants table
```

The grants table stays the source of truth and every grant change updates the column in the same transaction. A user with no column value, or with too many grants for one, is read from the table instead, so a half-migrated database is always correct.

**Claims.** For signed tokens, `permissions.issueClaims(user)` returns the same compact form plus a counter. Put it in the token and attach it on the next request with `withClaims(user, claims)`. A later grant change makes old claims stop applying.

**Warm-up.** `bunyad permissions:warm` builds role snapshots ahead of traffic; list scopes under `warm` in the config to do it at boot. `bunyad permissions:cache-clear [--scope=tenant:7]` makes every server recompute.

If the cache or its counters fail, checks answer from the database and a throttled warning is logged. A failure never allows access.

## Commands

| Command | Does |
|---|---|
| `permissions:sync` | Store the declared names; list names the code dropped |
| `permissions:warm` | Build role snapshots ahead of traffic |
| `permissions:cache-clear` | Make every server recompute (`--scope=` for one) |
| `permissions:prune` | Delete expired grants |
| `permissions:rebuild <type>` | Rewrite the user-row column from the grants table |
| `permissions:check-routes` | Report undeclared permissions in route middleware |
| `permissions:doctor` | Report grants pointing at a missing role or permission |

## Testing

Use the real package against an in-memory SQLite connection: create the tables with `createPermissionTables(schema)`, build `new Permissions({ db })`, and grant what the test needs.
