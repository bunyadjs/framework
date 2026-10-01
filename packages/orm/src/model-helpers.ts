/**
 * Shared ORM helpers (Model / relations / eager / ModelQuery).
 */
import type { Connection } from "@bunyad/database";
import { connections, dateTimeForStorage, wrapSqlName } from "@bunyad/database";
import type { ModelClass } from "./model.ts";

export function singular(name: string): string {
  if (name.endsWith("ies")) return `${name.slice(0, -3)}y`;
  if (name.endsWith("s")) return name.slice(0, -1);
  return name;
}

/** Parse `relation as alias` strings. */
export function parseRelationAlias(raw: string): { relation: string; alias?: string } {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  const m = text.match(/^(.+?)\s+as\s+(.+)$/i);
  if (!m) return { relation: text.trim() };
  return { relation: m[1]!.trim(), alias: m[2]!.trim() };
}

/** Constraint applied while eager-loading a relation (`with({ posts: (q) => … })`). */
export type EagerRelationConstraint = (query: {
  where: (...args: never[]) => unknown;
  [key: string]: unknown;
}) => void;

/** Normalized eager-load entry (path + optional constraint). */
export type NormalizedEagerRelation = {
  name: string;
  constraint?: EagerRelationConstraint;
};

/** Flatten `with('a', { b: true, c: fn }, ['d'])` into path + constraint entries. */
export function normalizeWithRelations(
  relations: Array<string | string[] | Record<string, unknown>>,
): NormalizedEagerRelation[] {
  const out: NormalizedEagerRelation[] = [];
  for (const rel of relations) {
    if (typeof rel === "string") {
      if (rel.trim()) out.push({ name: rel });
      continue;
    }
    if (Array.isArray(rel)) {
      for (const name of rel) {
        if (typeof name === "string" && name.trim()) out.push({ name });
      }
      continue;
    }
    if (rel && typeof rel === "object") {
      for (const [name, value] of Object.entries(rel)) {
        if (value === false || value == null) continue;
        if (typeof name !== "string" || !name.trim()) continue;
        if (typeof value === "function") {
          out.push({
            name,
            constraint: value as EagerRelationConstraint,
          });
        } else {
          out.push({ name });
        }
      }
    }
  }
  return out;
}

/** Coerce string paths or normalized entries for eager-load callers. */
export function coerceEagerRelations(
  relations: Array<string | NormalizedEagerRelation>,
): NormalizedEagerRelation[] {
  const out: NormalizedEagerRelation[] = [];
  for (const rel of relations) {
    if (typeof rel === "string") {
      if (rel.trim()) out.push({ name: rel });
    } else if (rel?.name?.trim()) {
      out.push(rel);
    }
  }
  return out;
}

export function usesSoftDeletes(model: ModelClass): boolean {
  return model.softDeletes === true;
}

export function deletedAtColumn(model: ModelClass): string {
  return model.deletedAt ?? "deleted_at";
}

/** Soft-delete predicate for a quoted table/alias (empty when model is not soft-deleting). */
export function softDeleteAliasSql(Related: ModelClass, aliasSql: string): string {
  if (!usesSoftDeletes(Related)) return "";
  const dialect = Related.getConnection().dialect;
  const col = wrapSqlName(dialect, deletedAtColumn(Related));
  return ` AND ${aliasSql}.${col} IS NULL`;
}

/** Current timestamp in the active driver's storage form. */
export function nowForConnection(connection?: Connection): Date | string {
  const driver =
    connection?.driver ?? connections.connection().driver ?? "sqlite";
  return dateTimeForStorage(new Date(), driver);
}

export function uniqueKeys(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
