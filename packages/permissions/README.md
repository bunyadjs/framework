# @bunyad/permissions

Roles, permissions, teams and tenants. A check is a bit test; a warm check runs no queries, a cold one runs one statement.

> **Beta.** Full guide: the Roles and Permissions page in the docs.

## Set up

```bash
bunx bunyad publish --tag=permissions-migrations   # database/migrations/…create_permission_tables.ts (+ optional users column)
bunx bunyad publish --tag=permissions-config       # config/permissions.ts
bunx bunyad migrate
bunx bunyad permissions:sync
```

The published files are yours to edit. `config/permissions.ts` turns the package on: without it nothing is registered.

## Use

```ts
await permissions.createRole("editor", "tenant:7");
await permissions.givePermissions({ name: "editor", scope: "tenant:7" }, ["posts.view", "posts.update"]);

@HasPermissions()
class User extends Model {}
interface User extends PermissionMethods {}

await user.grantRole("editor", "tenant:7");
await user.can("posts.update", "team:42");   // roles of the tenant apply inside its teams
```

Routes: `.middleware("permission:posts.update")`, `permission.any:a,b`, `role:admin`, and a scope from the URL: `permission:posts.update@team:{team}`.

Views and the Gate: `@can('posts.update')`, `@can('role:admin')`, `@can('posts.update', 'team:42')`, `Gate.allows(request, 'posts.update')`. Views cannot wait, so add the `permissions.load` middleware to routes that render them (any earlier permission check also works); until a user is loaded the directive says no.

## Customize

| What | How |
|---|---|
| Table names | `tables: { roles: "acl_roles" }` in config, same names in the published migration |
| Columns / types | Edit the published migration (keep the column names) |
| Current scope | `defaultScope: () => "tenant:7"` |
| Who can do everything | `superAdmin: (subject, scope) => …` |
| Scope parents | `scopes: { team: { parent: (id) => "tenant:…" } }` |
| Cache | `cache: "redis"` or `false`; `consistency: "strict" \| "eventual"`; `ttl` seconds |
| No grants query for loaded users | `columns: { user: { table: "users", column: "permission_access" } }` |
| Switch off pieces | `gate: false`, `middleware: false`, `commands: false` |
| Throw on unknown names | `strict` (default: on outside production) |
| Different subject types | `HasPermissions({ type: "account" })`; tokens and service accounts are subjects too |

For several processes give it a shared cache store so version counters are shared.

## More

- `whereCan` / `whereHasRole`: `(await User.whereCan("posts.update", "team:42")).paginate(20)`.
- `grantMany(users, { role: "editor" }, "tenant:7")`, `revokeAll(user)`, `copyRoles("*", "tenant:9")`.
- Signed tokens: `issueClaims(user)` then `withClaims(user, claims)` on the next request.
- Commands: `permissions:sync`, `:warm`, `:cache-clear`, `:prune`, `:rebuild`, `:check-routes`, `:doctor`.
- If the cache fails, checks answer from the database (a throttled warning is logged) and never allow by mistake.
