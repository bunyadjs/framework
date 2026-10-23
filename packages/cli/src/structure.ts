import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type Structure = "folders" | "classic";

/** What `bunyad new` shows when it asks, so the choice can be made without reading the docs. */
export const STRUCTURES: Record<Structure, { label: string; hint: string }> = {
  folders: {
    label: "Folders (recommended)",
    hint: "A folder is a URL. The controller, page, form request and tests for a screen sit together in routes/. Best for new apps and teams that work one feature at a time.",
  },
  classic: {
    label: "Classic",
    hint: "Code grouped by kind: app/Http/Controllers, routes/web.ts and routes/api.ts, pages in resources/. Best if you know this layout already or are moving an existing app over.",
  },
};

/** Whether any `*.routes.ts` or `*Controller.ts` sits in the route tree below `dir`. */
function hasRouteFiles(dir: string, depth = 0): boolean {
  if (depth > 6 || !existsSync(dir)) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (hasRouteFiles(join(dir, entry.name), depth + 1)) return true;
    } else if (/\.routes\.ts$|Controller\.ts$/.test(entry.name)) {
      return true;
    }
  }
  return false;
}

/**
 * How the app at `root` is laid out. `bunyad.json` says so when the app was scaffolded with a choice; an older
 * app is told apart by its files; an empty one gets folders.
 */
export function structureOf(root: string): Structure {
  try {
    const marker = JSON.parse(readFileSync(join(root, "bunyad.json"), "utf8")) as { structure?: string };
    if (marker.structure === "folders" || marker.structure === "classic") return marker.structure;
  } catch {
    // No marker (or an unreadable one): look at the files.
  }
  if (hasRouteFiles(join(root, "routes"))) return "folders";
  if (existsSync(join(root, "routes/web.ts")) || existsSync(join(root, "routes/api.ts")) || existsSync(join(root, "app/Http/Controllers"))) {
    return "classic";
  }
  return "folders";
}
