import type { FeatureIdentifier } from "./types.ts";

/** Null / global scope key. */
export const NULL_SCOPE = "";

/**
 * Serialize a scope for storage.
 * - `null` / `undefined` → global (`""`)
 * - primitives → string form
 * - objects with `toFeatureIdentifier()` → that string
 * - objects with `id` → `ConstructorName|id`
 */
export function scopeKey(scope: unknown): string {
  if (scope == null) return NULL_SCOPE;
  if (typeof scope === "string" || typeof scope === "number" || typeof scope === "boolean") {
    return String(scope);
  }
  if (typeof scope === "object") {
    const obj = scope as FeatureIdentifier;
    if (typeof obj.toFeatureIdentifier === "function") {
      return obj.toFeatureIdentifier();
    }
    if (obj.id != null) {
      const name =
        (obj as { constructor?: { name?: string } }).constructor?.name ||
        "Object";
      return `${name}|${obj.id}`;
    }
  }
  return JSON.stringify(scope);
}

/** A feature is active unless its resolved/stored value is strictly `false`. */
export function isActiveValue(value: unknown): boolean {
  return value !== false;
}
