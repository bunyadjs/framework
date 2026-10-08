/**
 * Read a model's table from the database and (a) print a TypeScript interface for its
 * columns, (b) report where the model and the table disagree.
 *
 * Used by `bunyad schema:types` and `bunyad schema:check`; usable directly in tests.
 */
import { schemaFor, type ColumnInfo, type Connection } from "@bunyad/database";
import { parseCast } from "./casts.ts";
import type { ModelClass } from "./model.ts";

type Driver = Connection["driver"];

/** The TypeScript type a column hydrates to, taking the model's cast into account. */
export function tsTypeForColumn(
  column: ColumnInfo,
  driver: Driver,
  cast?: unknown,
): string {
  let base = castType(cast) ?? databaseType(column.type.toLowerCase(), driver);
  if (column.nullable && !column.primary) base += " | null";
  return base;
}

function castType(cast: unknown): string | null {
  if (typeof cast === "object" && cast !== null) return null; // Attribute / enum: leave to the database type
  if (typeof cast !== "string") return null;
  const parsed = parseCast(cast);
  if (!parsed) return null;
  switch (parsed.type) {
    case "boolean":
    case "bool":
      return "boolean";
    case "integer":
    case "int":
    case "number":
    case "float":
    case "double":
    case "real":
      return "number";
    case "decimal":
      return parsed.arg !== undefined ? "string" : "number";
    case "bigint":
      return "bigint";
    case "string":
    case "hashed":
    case "encrypted":
      return "string";
    case "date":
    case "datetime":
      return "Date";
    case "json":
      return "unknown";
    case "array":
      return "unknown[]";
    case "collection":
      return "Collection<unknown>";
    default:
      return "unknown"; // encrypted:json, encrypted:array, …
  }
}

function databaseType(type: string, driver: Driver): string {
  const t = type.replace(/\(.*\)/, "").trim();
  if (/^(bool|boolean)$/.test(t)) return driver === "sqlite" ? "number" : "boolean";
  if (/^tinyint/.test(t)) return "number";
  if (/^(smallint|integer|int|int2|int4|mediumint|serial|smallserial|float|real|double( precision)?|float4|float8)$/.test(t)) return "number";
  if (/^(bigint|int8|bigserial)$/.test(t)) return "number | bigint";
  if (/^(numeric|decimal|money)$/.test(t)) return "number | string"; // drivers disagree: some return exact strings
  if (/^(date|datetime|timestamp|timestamptz|timestamp without time zone|timestamp with time zone)$/.test(t)) {
    return driver === "sqlite" ? "string" : "Date";
  }
  if (/^(json|jsonb)$/.test(t)) return driver === "sqlite" ? "string" : "unknown";
  if (/^(blob|bytea|binary|varbinary|longblob)$/.test(t)) return "Uint8Array";
  return "string"; // text, varchar, char, uuid, enum, time, …
}

function modelName(model: ModelClass): string {
  return (model as { name?: string }).name || "Model";
}

/**
 * `export interface UserColumns { id: number; … }` for one model. Pair it with the model class via
 * declaration merging: `export interface User extends UserColumns {}`.
 */
export async function modelColumnsInterface(
  model: ModelClass,
  connection: Connection = model.getConnection(),
): Promise<string> {
  const columns = await schemaFor(connection).getColumns(model.table);
  if (columns.length === 0) {
    throw new Error(`Table [${model.table}] does not exist (model ${modelName(model)}).`);
  }
  const casts = model.getCasts() as Record<string, unknown>;
  const lines = columns.map(
    (c) => `  ${c.name}: ${tsTypeForColumn(c, connection.driver, casts[c.name])};`,
  );
  return `/** Columns of \`${model.table}\`. */\nexport interface ${modelName(model)}Columns {\n${lines.join("\n")}\n}\n`;
}

export type SchemaIssue = {
  severity: "error" | "warning";
  model: string;
  table: string;
  message: string;
};

/** Where a model's settings reference columns the table does not have. */
export async function checkModelSchema(
  model: ModelClass,
  connection: Connection = model.getConnection(),
): Promise<SchemaIssue[]> {
  const name = modelName(model);
  const table = model.table;
  const issue = (severity: SchemaIssue["severity"], message: string): SchemaIssue => ({ severity, model: name, table, message });
  const columns = await schemaFor(connection).getColumns(table);
  if (columns.length === 0) return [issue("error", `table [${table}] does not exist`)];
  const names = new Set(columns.map((c) => c.name));
  const issues: SchemaIssue[] = [];

  const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);
  for (const [setting, values] of [["fillable", list(model.fillable)], ["guarded", list(model.guarded).filter((v) => v !== "*")], ["hidden", list(model.hidden)], ["visible", list(model.visible)]] as const) {
    for (const column of values) {
      if (!names.has(column)) issues.push(issue("error", `${setting} lists [${column}], which is not a column of [${table}]`));
    }
  }
  for (const [column, cast] of Object.entries(model.getCasts() as Record<string, unknown>)) {
    // `Attribute.make` casts describe computed attributes; only plain casts must match a column.
    if (typeof cast === "string" && !names.has(column)) issues.push(issue("error", `cast for [${column}] has no matching column in [${table}]`));
  }
  if (!names.has(model.primaryKey)) {
    issues.push(issue("error", `primary key [${model.primaryKey}] is not a column of [${table}]`));
  }
  if (model.timestamps !== false) {
    for (const column of ["created_at", "updated_at"]) {
      if (!names.has(column)) issues.push(issue("error", `timestamps are on but [${table}] has no [${column}] column`));
    }
  }
  if (model.softDeletes && !names.has("deleted_at")) {
    issues.push(issue("error", `softDeletes is on but [${table}] has no [deleted_at] column`));
  }
  const known = new Set<string>([...list(model.fillable), ...list(model.hidden), ...list(model.visible), model.primaryKey, "created_at", "updated_at", "deleted_at", ...Object.keys(model.getCasts())]);
  const untracked = columns.filter((c) => !known.has(c.name) && !c.primary).map((c) => c.name);
  if (untracked.length > 0 && list(model.fillable).length > 0) {
    issues.push(issue("warning", `columns not in fillable, hidden or casts: ${untracked.join(", ")}`));
  }
  return issues;
}

/** The whole `models.generated.ts` file for the given models. */
export async function generateModelTypes(
  models: ModelClass[],
  connection?: Connection,
): Promise<string> {
  const sorted = [...models].sort((a, b) => modelName(a).localeCompare(modelName(b)));
  const parts: string[] = [];
  for (const model of sorted) parts.push(await modelColumnsInterface(model, connection ?? model.getConnection()));
  const body = parts.join("\n");
  const header =
    "// Generated by `bunyad schema:types`. Do not edit; run it again after changing a migration.\n" +
    (body.includes("Collection<") ? 'import type { Collection } from "@bunyad/common";\n' : "") +
    "\n";
  return header + body;
}
