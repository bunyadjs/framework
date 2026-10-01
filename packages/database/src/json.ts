import type { DriverName } from "./dialect.ts";
import { isMysqlFamily } from "./dialect.ts";

/** Split `meta->color` / `meta->items[0]` into column + JSON path. */
export function parseJsonColumn(column: string): {
  field: string;
  path: string;
  segments: string[];
} {
  const parts = column.split(/->>?/);
  const field = parts[0]!.trim();
  const segments: string[] = [];
  for (const part of parts.slice(1)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const re = /([^\[\]]+)|\[(\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(trimmed)) !== null) {
      if (match[1] !== undefined && match[1] !== "") {
        segments.push(match[1]);
      } else if (match[2] !== undefined) {
        segments.push(match[2]);
      }
    }
  }
  let path = "$";
  for (const seg of segments) {
    path += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  }
  return { field, path, segments };
}

/** Encode a value for JSON containment checks. */
export function jsonBinding(value: unknown): string {
  return JSON.stringify(value);
}

function postgresExtract(field: string, segments: string[]): string {
  let expr = field;
  for (const seg of segments) {
    if (/^\d+$/.test(seg)) {
      expr = `${expr}->${seg}`;
    } else {
      expr = `${expr}->'${seg.replaceAll("'", "''")}'`;
    }
  }
  return expr;
}

function sqliteExtract(field: string, segments: string[]): string {
  if (segments.length === 0) return field;
  let pathOnly = "$";
  for (const seg of segments) {
    pathOnly += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  }
  return `json_extract(${field}, '${pathOnly}')`;
}

/**
 * Dialect SQL for `whereJsonContains` / `whereJsonDoesntContain`.
 * Caller binds via `jsonContainsParams`.
 */
export function jsonContainsSql(
  column: string,
  value: unknown,
  driver: DriverName,
  not = false,
): { sql: string; params: unknown[] } {
  const { field, path, segments } = parseJsonColumn(column);
  const negate = not ? "NOT " : "";
  const encoded = jsonBinding(value);

  if (isMysqlFamily(driver)) {
    const pathArg = segments.length > 0 ? `, '${path}'` : "";
    return {
      sql: `${negate}JSON_CONTAINS(${field}, ?${pathArg})`,
      params: [encoded],
    };
  }

  switch (driver) {
    case "postgres": {
      const extracted =
        segments.length === 0
          ? `${field}::jsonb`
          : `(${postgresExtract(field, segments)})::jsonb`;
      return {
        sql: `${negate}(${extracted} @> ?::jsonb)`,
        params: [encoded],
      };
    }
    case "sqlsrv": {
      // Approximate containment via JSON_QUERY / equality on serialized JSON.
      const target =
        segments.length > 0
          ? `JSON_QUERY(${field}, '${path}')`
          : field;
      return {
        sql: `${negate}(${target} = ?)`,
        params: [encoded],
      };
    }
    case "sqlite": {
      const target = sqliteExtract(field, segments);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);
        if (keys.length === 0) {
          return { sql: `${negate}(1 = 1)`, params: [] };
        }
        const parts = keys.map(
          (key) =>
            `json_extract(${target}, '$.${key.replaceAll("'", "''")}') = json_extract(json(?), '$.${key.replaceAll("'", "''")}')`,
        );
        return {
          sql: `${negate}(${parts.join(" AND ")})`,
          params: keys.map(() => encoded),
        };
      }
      const scalarParam =
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
          ? String(value)
          : encoded;
      return {
        sql: `${negate}EXISTS (SELECT 1 FROM json_each(${target}) WHERE CAST(value AS TEXT) = ? OR value = json(?))`,
        params: [scalarParam, encoded],
      };
    }
    default:
      return { sql: `${negate}(1 = 0)`, params: [] };
  }
}

/** Dialect expression for `whereJsonLength`. */
export function jsonLengthExpression(
  column: string,
  driver: DriverName,
): string {
  const { field, path, segments } = parseJsonColumn(column);
  if (isMysqlFamily(driver)) {
    return segments.length > 0
      ? `JSON_LENGTH(${field}, '${path}')`
      : `JSON_LENGTH(${field})`;
  }
  switch (driver) {
    case "postgres":
      return segments.length > 0
        ? `jsonb_array_length((${postgresExtract(field, segments)})::jsonb)`
        : `jsonb_array_length((${field})::jsonb)`;
    case "sqlsrv":
      return segments.length > 0
        ? `(SELECT COUNT(*) FROM OPENJSON(${field}, '${path}'))`
        : `(SELECT COUNT(*) FROM OPENJSON(${field}))`;
    case "sqlite":
      return segments.length > 0
        ? `json_array_length(${field}, '${path}')`
        : `json_array_length(${field})`;
    default:
      return `0`;
  }
}

/** Dialect SQL for `whereJsonContainsKey` / `whereJsonDoesntContainKey`. */
export function jsonContainsKeySql(
  column: string,
  driver: DriverName,
  not = false,
): string {
  const { field, path, segments } = parseJsonColumn(column);
  if (segments.length === 0) {
    throw new Error(
      "whereJsonContainsKey requires a JSON path (e.g. meta->color)",
    );
  }
  const negate = not ? "NOT " : "";
  const last = segments[segments.length - 1]!;
  const parentSegs = segments.slice(0, -1);

  if (isMysqlFamily(driver)) {
    return `${negate}JSON_CONTAINS_PATH(${field}, 'one', '${path}')`;
  }

  switch (driver) {
    case "postgres": {
      const parent =
        parentSegs.length === 0
          ? `${field}::jsonb`
          : `(${postgresExtract(field, parentSegs)})::jsonb`;
      return `${negate}jsonb_exists(${parent}, '${last.replaceAll("'", "''")}')`;
    }
    case "sqlsrv":
      return `${negate}JSON_PATH_EXISTS(${field}, 'lax ${path}')`;
    case "sqlite": {
      const parent = sqliteExtract(field, parentSegs);
      return `${negate}(json_type(${parent}, '$.${last.replaceAll("'", "''")}') IS NOT NULL)`;
    }
    default:
      return `${negate}(1 = 0)`;
  }
}

/** Full-text search fragment (`whereFullText`). */
export function fullTextSql(
  columns: string[],
  driver: DriverName,
): { sql: string; bindingCount: number } {
  const cols = columns.join(", ");
  if (isMysqlFamily(driver)) {
    return {
      sql: `MATCH(${cols}) AGAINST(? IN BOOLEAN MODE)`,
      bindingCount: 1,
    };
  }
  switch (driver) {
    case "postgres": {
      const vector = columns
        .map((c) => `to_tsvector('english', coalesce(${c}, ''))`)
        .join(" || ");
      return {
        sql: `(${vector}) @@ plainto_tsquery('english', ?)`,
        bindingCount: 1,
      };
    }
    case "sqlsrv": {
      // CONTAINS requires a full-text index; fall back to OR LIKE for portability.
      const parts = columns.map((c) => `${c} LIKE ?`);
      return { sql: `(${parts.join(" OR ")})`, bindingCount: columns.length };
    }
    case "sqlite": {
      const parts = columns.map((c) => `${c} LIKE ?`);
      return { sql: `(${parts.join(" OR ")})`, bindingCount: columns.length };
    }
    default:
      return { sql: `(1 = 0)`, bindingCount: 0 };
  }
}

/** Lock clause — empty on SQLite / SQL Server (hint style differs). */
export function lockClause(
  lock: false | "update" | "shared" | string,
  driver: DriverName,
): string {
  if (lock === false) return "";
  if (typeof lock === "string" && lock !== "update" && lock !== "shared") {
    return ` ${lock}`;
  }
  if (driver === "sqlite" || driver === "sqlsrv") return "";
  if (lock === "update") return " FOR UPDATE";
  if (isMysqlFamily(driver)) return " LOCK IN SHARE MODE";
  return " FOR SHARE";
}
