/**
 * Shared key IN (...) fetch for eager load and HasManyThrough lazy get.
 */
import { wrapSqlName } from "@bunyad/database";
import { hasGlobalScopes } from "./scopes.ts";
import { softDeleteAliasSql } from "./model-helpers.ts";
import { Model, type ModelClass } from "./model.ts";

/**
 * Fetch related models by key IN (...) for eager load.
 * Prefer raw SQL + light hydrate (matches ofMany) when the related model has
 * no global scopes; fall back to ModelQuery when scopes must run.
 */
export async function eagerFetchByKeys(
  Related: ModelClass,
  keyColumn: string,
  ids: unknown[],
): Promise<Model[]> {
  if (ids.length === 0) return [];
  if (hasGlobalScopes(Related)) {
    const collection = await Related.whereIn(keyColumn, ids).get();
    return collection.all();
  }
  const conn = Related.getConnection();
  const dialect = conn.dialect;
  const table = wrapSqlName(dialect, Related.table);
  const key = wrapSqlName(dialect, keyColumn);
  const soft = softDeleteAliasSql(Related, table);
  const placeholders = ids.map(() => "?").join(", ");
  const sql = `SELECT ${table}.* FROM ${table} WHERE ${table}.${key} IN (${placeholders})${soft}`;
  // Prefer sync SQLite reads — matches BelongsTo().first() → find() hot path.
  const rows = (
    conn.allSync
      ? conn.allSync<Record<string, unknown>>(sql, ids)
      : await conn.all<Record<string, unknown>>(sql, ids)
  ) as Record<string, unknown>[];
  const models = new Array<Model>(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const model = new Related(rows[i]!);
    model.exists = true;
    models[i] = model;
  }
  return models;
}
