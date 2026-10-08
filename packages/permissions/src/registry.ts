import { type Bitmap, emptyBitmap, setBit } from "./bitmap.ts";

export type PermissionDefinitions = Record<string, string[] | { actions: string[]; label?: string }>;

/** Flatten `{ posts: ['view','update'] }` into `['posts.view', 'posts.update']`. */
export function definePermissions(definitions: PermissionDefinitions): string[] {
  const names: string[] = [];
  for (const [group, value] of Object.entries(definitions)) {
    const actions = Array.isArray(value) ? value : value.actions;
    for (const action of actions) names.push(`${group}.${action}`);
  }
  return names;
}

export const isPattern = (name: string): boolean => name === "*" || name.endsWith(".*");

/** Does the pattern (`*`, `posts.*`) cover the concrete permission name? */
export function patternCovers(pattern: string, name: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.endsWith(".*")) return pattern === name;
  return name.startsWith(pattern.slice(0, -1));
}

/**
 * Name <-> id map. Wildcards are stored as permissions too and expanded to
 * concrete ids here, so a check never does pattern matching.
 */
export class PermissionRegistry {
  #ids = new Map<string, number>();
  #names = new Map<number, string>();
  #expansion = new Map<number, Bitmap>();

  load(rows: Array<{ id: number; name: string }>): void {
    this.#ids.clear();
    this.#names.clear();
    this.#expansion.clear();
    for (const row of rows) {
      this.#ids.set(row.name, Number(row.id));
      this.#names.set(Number(row.id), row.name);
    }
  }

  get size(): number {
    return this.#ids.size;
  }

  idOf(name: string): number | undefined {
    return this.#ids.get(name);
  }

  nameOf(id: number): string | undefined {
    return this.#names.get(id);
  }

  /** Wildcard permission names (`*`, `posts.*`). */
  wildcards(): string[] {
    return [...this.#ids.keys()].filter(isPattern);
  }

  /** Concrete (non-wildcard) permission names, sorted. */
  names(): string[] {
    return [...this.#ids.keys()].filter((n) => !isPattern(n)).sort();
  }

  /** The bits a permission id grants: itself, plus every concrete id for a wildcard. */
  bitsFor(id: number): Bitmap {
    let map = this.#expansion.get(id);
    if (map) return map;
    map = setBit(emptyBitmap(), id);
    const name = this.#names.get(id);
    if (name !== undefined && isPattern(name)) {
      for (const [other, otherId] of this.#ids) {
        if (!isPattern(other) && patternCovers(name, other)) map = setBit(map, otherId);
      }
    }
    this.#expansion.set(id, map);
    return map;
  }
}
