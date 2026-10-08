import { aliasMiddleware, json, taggedMiddleware, type Next, type Request } from "@bunyad/http";
import { getTokenGuard } from "@bunyad/auth";
import { subjectFromUser } from "./has-permissions.ts";
import { type Permissions, getPermissions } from "./manager.ts";

type Resolver = () => Permissions;

type Requirement = { name: string; scope?: string };

/** `posts.update` or `posts.update@team:{team}` (route parameters in braces fill the scope). */
function parse(spec: string): Requirement {
  const at = spec.indexOf("@");
  return at === -1 ? { name: spec } : { name: spec.slice(0, at), scope: spec.slice(at + 1) };
}

function scopeFor(request: Request, template?: string): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(request.route(key) ?? ""));
}

/** An API token narrows its owner: it needs the ability as well as the permission. */
function tokenAllows(request: Request, ability: string): boolean {
  const guard = getTokenGuard();
  if (!guard || !guard.currentAccessToken(request)) return true;
  return guard.tokenCan(request, ability);
}

const unauthenticated = () => json({ message: "Unauthenticated." }, 401);
const forbidden = () => json({ message: "This action is unauthorized." }, 403);

function guardWith(
  alias: string,
  evaluate: (permissions: Permissions, request: Request, user: { id: string | number }) => Promise<boolean>,
  get: Resolver,
) {
  return taggedMiddleware(alias, {
    handle(request: Request, next: Next) {
      const permissions = get();
      // Everything downstream (later middleware, the controller, views) shares one per-request memo.
      return permissions.runRequest(async () => {
        const user = request.user as { id: string | number } | undefined;
        if (!user) return unauthenticated();
        return (await evaluate(permissions, request, user)) ? next() : forbidden();
      });
    },
  });
}

/** `permission:a,b` - the user needs every listed permission (and token ability). */
export function permission(specs: string[], get: Resolver = getPermissions) {
  const required = specs.map(parse);
  return guardWith(
    `permission:${specs.join(",")}`,
    async (permissions, request, user) => {
      const subject = subjectFromUser(user);
      for (const item of required) {
        if (!tokenAllows(request, item.name)) return false;
        if (!(await permissions.can(subject, item.name, scopeFor(request, item.scope)))) return false;
      }
      return true;
    },
    get,
  );
}

/** `permission.any:a,b` - at least one listed permission. */
export function permissionAny(specs: string[], get: Resolver = getPermissions) {
  const required = specs.map(parse);
  return guardWith(
    `permission.any:${specs.join(",")}`,
    async (permissions, request, user) => {
      const subject = subjectFromUser(user);
      for (const item of required) {
        if (!tokenAllows(request, item.name)) continue;
        if (await permissions.can(subject, item.name, scopeFor(request, item.scope))) return true;
      }
      return false;
    },
    get,
  );
}

/** `role:admin,editor` - at least one listed role, optionally scoped like `role:admin@tenant:{tenant}`. */
export function role(specs: string[], get: Resolver = getPermissions) {
  const required = specs.map(parse);
  return guardWith(
    `role:${specs.join(",")}`,
    async (permissions, request, user) => {
      const subject = subjectFromUser(user);
      for (const item of required) {
        if (await permissions.hasRole(subject, item.name, scopeFor(request, item.scope))) return true;
      }
      return false;
    },
    get,
  );
}

/**
 * `permissions.load` - put the signed-in user's permissions in memory for this request, so `@can` in views
 * (which cannot wait) answers. Never blocks the request: a guest or a failure just passes through.
 */
export function loadPermissions(get: Resolver = getPermissions) {
  return taggedMiddleware("permissions.load", {
    handle(request: Request, next: Next) {
      const permissions = get();
      return permissions.runRequest(async () => {
        const user = request.user as { id: string | number } | undefined;
        if (user) {
          try {
            await permissions.load(subjectFromUser(user));
          } catch {
            // A failed warm-up must not break the page: checks will fall back to the async path.
          }
        }
        return next();
      });
    },
  });
}

/** Register `permission`, `permission.any` and `role` so routes can use `.middleware('permission:posts.update')`. */
export function registerPermissionMiddleware(get: Resolver = getPermissions): void {
  aliasMiddleware("permission", (...params) => permission(params, get));
  aliasMiddleware("permission.any", (...params) => permissionAny(params, get));
  aliasMiddleware("role", (...params) => role(params, get));
  aliasMiddleware("permissions.load", () => loadPermissions(get));
}
