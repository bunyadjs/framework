import { registerProviderCommand } from "@bunyad/core";
import { type Permissions, getPermissions } from "./manager.ts";
import { patternCovers } from "./registry.ts";

export type PermissionCommandOptions = {
  permissions?: () => Permissions;
  /** The permission names the app declares (from `definePermissions`). */
  declared: () => string[] | Promise<string[]>;
  /** Scopes `permissions:warm` builds snapshots for (default: the global scope). */
  warm?: () => string[];
};

/**
 * Register `permissions:sync`, `:warm`, `:cache-clear`, `:prune`, `:rebuild`, `:check-routes` and `:doctor`.
 * Call from a service provider's boot, like other provider commands.
 */
export function registerPermissionCommands(options: PermissionCommandOptions): void {
  const get = options.permissions ?? getPermissions;

  registerProviderCommand("permissions:sync", async () => {
    const permissions = get();
    const declared = await options.declared();
    await permissions.sync(declared);
    const orphans = await permissions.orphans(declared);
    console.log(`Synced ${declared.length} permissions.`);
    if (orphans.length > 0) {
      console.log(`Not declared in code any more (kept, remove by hand when unused): ${orphans.join(", ")}`);
    }
  });

  registerProviderCommand("permissions:prune", async () => {
    console.log(`Removed ${await get().pruneExpired()} expired grants.`);
  });

  registerProviderCommand("permissions:rebuild", async (args) => {
    const type = args[0];
    if (!type) {
      console.log("Usage: permissions:rebuild <subject-type>   (for example: permissions:rebuild user)");
      process.exitCode = 1;
      return;
    }
    console.log(`Rebuilt the access column of ${await get().rebuildAccess(type)} ${type} subjects.`);
  });

  registerProviderCommand("permissions:warm", async (args) => {
    const scopes = args.length > 0 ? args : (options.warm?.() ?? ["*"]);
    await get().warm(scopes);
    console.log(`Warmed role snapshots for ${scopes.join(", ")}.`);
  });

  registerProviderCommand("permissions:cache-clear", async (args) => {
    const scope = args.find((arg) => arg.startsWith("--scope="))?.slice("--scope=".length);
    await get().clearCache(scope);
    console.log(scope ? `Permission cache cleared for ${scope}.` : "Permission cache cleared.");
  });

  registerProviderCommand("permissions:check-routes", async () => {
    // Routes register themselves when their files load, the same way `route:list` reads them.
    const { resolve } = await import("node:path");
    const { access } = await import("node:fs/promises");
    const { Route } = await import("@bunyad/router");
    for (const name of ["web.ts", "api.ts"]) {
      const file = resolve(process.cwd(), "routes", name);
      try {
        await access(file);
      } catch {
        continue;
      }
      const loaded = (await import(file)) as { default?: (route: typeof Route) => unknown };
      if (typeof loaded.default === "function") await loaded.default(Route);
    }
    const unknown = unknownPermissionsInRoutes(Route.routes, new Set(await options.declared()));
    if (unknown.length === 0) {
      console.log("Every permission and role named in route middleware is declared.");
      return;
    }
    for (const item of unknown) console.log(`${item.uri}: ${item.middleware} names unknown permission [${item.name}]`);
    process.exitCode = 1;
  });

  registerProviderCommand("permissions:doctor", async () => {
    const permissions = get();
    const dangling = await permissions.store.danglingGrantCount();
    console.log(`Grants pointing at a missing role: ${dangling.roles}`);
    console.log(`Grants pointing at a missing permission: ${dangling.permissions}`);
    if (dangling.roles + dangling.permissions > 0) process.exitCode = 1;
  });
}

type RouteLike = { uri: string; middleware: readonly unknown[] };

/**
 * Permission names used in route middleware (`permission:`, `permission.any:`) that the app never declared.
 * Roles are not checked: they live in the database. Wildcards and scopes (`posts.*`, `…@team:{team}`) are understood.
 */
export function unknownPermissionsInRoutes(
  routes: readonly RouteLike[],
  declared: ReadonlySet<string>,
): Array<{ uri: string; middleware: string; name: string }> {
  const found: Array<{ uri: string; middleware: string; name: string }> = [];
  for (const route of routes) {
    for (const entry of route.middleware) {
      const alias = typeof entry === "string" ? entry : (entry as { alias?: string } | null)?.alias;
      const match = alias && /^(permission|permission\.any):(.+)$/.exec(alias);
      if (!match) continue;
      for (const spec of match[2]!.split(",")) {
        const name = spec.split("@")[0]!;
        const covered = name === "*" || name.endsWith(".*") ? [...declared].some((d) => patternCovers(name, d)) : declared.has(name);
        if (!covered) found.push({ uri: route.uri, middleware: alias!, name });
      }
    }
  }
  return found;
}
