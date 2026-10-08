import { getTokenGuard } from "@bunyad/auth";
import { subjectFromUser } from "./has-permissions.ts";
import { type Permissions, getPermissions } from "./manager.ts";

type GateLike = {
  before(callback: (user: any, ability: string, ...args: unknown[]) => unknown): unknown;
};

const ROLE_PREFIX = "role:";

/**
 * Let `Gate.allows('posts.update')`, `authorize(request, 'posts.update')` and the view directive
 * `@can('posts.update')` consult permissions. A string argument names the scope:
 * `Gate.allows(request, 'posts.update', 'team:42')`. `role:admin` checks a role the same way.
 *
 * The hook only ever **allows**: it returns `true` for a held permission and defers (`null`) otherwise,
 * so policies and ability callbacks keep deciding everything else. Abilities called with model arguments
 * (`Gate.allows('update', post)`) are left to policies.
 *
 * When the subject is already in memory the hook answers synchronously, which is what `@can` in a view
 * needs (views cannot wait). Run the `permissions.load` middleware (or any earlier check) to put it there.
 */
export function installPermissionGate(gate: GateLike, get: () => Permissions = getPermissions): void {
  gate.before((user, ability, ...args) => {
    if (!user) return null;
    let scope: string | undefined;
    if (args.length === 1 && typeof args[0] === "string") scope = args[0];
    else if (args.length > 0) return null;

    const permissions = get();
    const subject = subjectFromUser(user);

    if (ability.startsWith(ROLE_PREFIX)) {
      const role = ability.slice(ROLE_PREFIX.length);
      const now = permissions.hasRoleNow(subject, role, scope);
      if (now !== undefined) return now ? true : null;
      return permissions.hasRole(subject, role, scope).then((held) => (held ? true : null));
    }

    const narrowed = (): boolean => {
      const token = getTokenGuard();
      return !!token && !!token.currentAccessToken(user) && !token.tokenCan(user, ability);
    };

    if (permissions.registry.size > 0 && permissions.registry.idOf(ability) === undefined) return null;
    const now = permissions.canNow(subject, ability, scope);
    if (now !== undefined) return now && !narrowed() ? true : null;

    return (async () => {
      if (!(await permissions.knows(ability))) return null;
      if (narrowed()) return null;
      return (await permissions.can(subject, ability, scope)) ? true : null;
    })();
  });
}
