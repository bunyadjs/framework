import type { Connection } from "./connection.ts";
import type { Dialect, LogicalColumn } from "./dialect.ts";
import { dialectFor, isMysqlFamily } from "./dialect.ts";

type IndexCommand = {
  type: "index" | "unique";
  columns: string[];
  name?: string;
  where?: string;
};

type ForeignCommand = {
  columns: string[];
  name?: string;
  referencesColumn: string;
  onTable?: string;
  onDelete?: string;
  onUpdate?: string;
};

function asArray(columns: string | string[]): string[] {
  return Array.isArray(columns) ? columns : [columns];
}

/** `category_id` → `categories`; `user_id` → `users`. */
export function inferTableFromForeignId(column: string): string {
  const base = column.endsWith("_id") ? column.slice(0, -3) : column;
  if (base.endsWith("y") && !/[aeiou]y$/i.test(base)) {
    return `${base.slice(0, -1)}ies`;
  }
  if (/(s|x|z|ch|sh)$/i.test(base)) {
    return `${base}es`;
  }
  return `${base}s`;
}

function defaultIndexName(
  table: string,
  columns: string[],
  type: "index" | "unique" | "foreign",
): string {
  const suffix = type === "unique" ? "unique" : type === "foreign" ? "foreign" : "index";
  return `${table}_${columns.join("_")}_${suffix}`;
}

function compileIndex(
  dialect: Dialect,
  table: string,
  cmd: IndexCommand,
): string {
  const q = (name: string) => dialect.quoteIdentifier(name);
  const name =
    cmd.name ?? defaultIndexName(table, cmd.columns, cmd.type);
  const cols = cmd.columns.map(q).join(", ");
  const unique = cmd.type === "unique" ? "UNIQUE " : "";
  let sql = `CREATE ${unique}INDEX ${q(name)} ON ${q(table)} (${cols})`;
  if (cmd.where) {
    sql += ` WHERE ${cmd.where}`;
  }
  return sql;
}

function compileForeignConstraint(
  dialect: Dialect,
  table: string,
  cmd: ForeignCommand,
): string {
  const q = (name: string) => dialect.quoteIdentifier(name);
  const name =
    cmd.name ?? defaultIndexName(table, cmd.columns, "foreign");
  const cols = cmd.columns.map(q).join(", ");
  const onTable =
    cmd.onTable ?? inferTableFromForeignId(cmd.columns[0] ?? table);
  const refs = dialect.quoteIdentifier(cmd.referencesColumn);
  let sql = `CONSTRAINT ${q(name)} FOREIGN KEY (${cols}) REFERENCES ${q(onTable)} (${refs})`;
  if (cmd.onDelete) {
    sql += ` ON DELETE ${cmd.onDelete.toUpperCase()}`;
  }
  if (cmd.onUpdate) {
    sql += ` ON UPDATE ${cmd.onUpdate.toUpperCase()}`;
  }
  return sql;
}

function compileAlterForeign(
  dialect: Dialect,
  table: string,
  cmd: ForeignCommand,
): string {
  return `ALTER TABLE ${dialect.quoteIdentifier(table)} ADD ${compileForeignConstraint(dialect, table, cmd)}`;
}

function compileDropIndex(
  dialect: Dialect,
  table: string,
  name: string,
): string {
  const q = (n: string) => dialect.quoteIdentifier(n);
  if (isMysqlFamily(dialect.driver)) {
    return `ALTER TABLE ${q(table)} DROP INDEX ${q(name)}`;
  }
  if (dialect.driver === "sqlsrv") {
    return `DROP INDEX ${q(name)} ON ${q(table)}`;
  }
  return `DROP INDEX IF EXISTS ${q(name)}`;
}

/**
 * Fluent `index()` / `unique()` builder (`where` for partial indexes).
 */
export class IndexDefinition {
  constructor(private cmd: IndexCommand) {}

  where(sql: string): this {
    this.cmd.where = sql;
    return this;
  }
}

/**
 * Fluent foreign-key builder (`references` / `on` / `onDelete`).
 */
export class ForeignKeyDefinition {
  constructor(private cmd: ForeignCommand) {}

  references(column: string): this {
    this.cmd.referencesColumn = column;
    return this;
  }

  on(table: string): this {
    this.cmd.onTable = table;
    return this;
  }

  onDelete(action: string): this {
    this.cmd.onDelete = action;
    return this;
  }

  onUpdate(action: string): this {
    this.cmd.onUpdate = action;
    return this;
  }

  cascadeOnDelete(): this {
    return this.onDelete("cascade");
  }

  restrictOnDelete(): this {
    return this.onDelete("restrict");
  }

  nullOnDelete(): this {
    return this.onDelete("set null");
  }

  cascadeOnUpdate(): this {
    return this.onUpdate("cascade");
  }

  restrictOnUpdate(): this {
    return this.onUpdate("restrict");
  }

  nullOnUpdate(): this {
    return this.onUpdate("set null");
  }

  noActionOnUpdate(): this {
    return this.onUpdate("no action");
  }

  noActionOnDelete(): this {
    return this.onDelete("no action");
  }
}

type SchemaCommandHost = {
  index(columns: string | string[], name?: string): IndexDefinition;
  unique(columns: string | string[], name?: string): IndexDefinition;
  foreign(columns: string | string[], name?: string): ForeignKeyDefinition;
};

/**
 * Column modifier chain (`nullable`, `default`, `constrained`, …).
 */
export class ColumnBuilder {
  #fk?: ForeignKeyDefinition;

  constructor(
    private col: LogicalColumn,
    private host?: SchemaCommandHost,
  ) {}

  primary(): this {
    this.col.primary = true;
    return this;
  }

  unique(value: boolean | string = true): this {
    if (value === false) {
      this.col.unique = false;
      return this;
    }
    if (typeof value === "string") {
      this.host?.unique(this.col.name, value);
      return this;
    }
    this.col.unique = true;
    return this;
  }

  nullable(value = true): this {
    this.col.nullable = value;
    return this;
  }

  notNullable(): this {
    return this.nullable(false);
  }

  default(value: string | number | boolean | null): this {
    this.col.defaultValue = value;
    return this;
  }

  /** Unquoted default expression (`NOW()`, `CURRENT_TIMESTAMP`). */
  defaultRaw(sql: string): this {
    this.col.rawDefault = sql;
    return this;
  }

  useCurrent(): this {
    this.col.useCurrent = true;
    return this;
  }

  index(name?: string): this {
    this.host?.index(this.col.name, name);
    return this;
  }

  constrained(table?: string, column = "id"): this {
    this.#fk = this.host?.foreign(this.col.name);
    this.#fk
      ?.on(table ?? inferTableFromForeignId(this.col.name))
      .references(column);
    return this;
  }

  cascadeOnDelete(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.cascadeOnDelete();
    return this;
  }

  restrictOnDelete(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.restrictOnDelete();
    return this;
  }

  nullOnDelete(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.nullOnDelete();
    return this;
  }

  cascadeOnUpdate(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.cascadeOnUpdate();
    return this;
  }

  restrictOnUpdate(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.restrictOnUpdate();
    return this;
  }

  nullOnUpdate(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.nullOnUpdate();
    return this;
  }

  noActionOnUpdate(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.noActionOnUpdate();
    return this;
  }

  noActionOnDelete(): this {
    if (!this.#fk) this.constrained();
    this.#fk?.noActionOnDelete();
    return this;
  }

  onDelete(action: string): this {
    if (!this.#fk) this.constrained();
    this.#fk?.onDelete(action);
    return this;
  }

  onUpdate(action: string): this {
    if (!this.#fk) this.constrained();
    this.#fk?.onUpdate(action);
    return this;
  }
}

abstract class ColumnBlueprint implements SchemaCommandHost {
  readonly columns: LogicalColumn[] = [];
  readonly indexes: IndexCommand[] = [];
  readonly foreigns: ForeignCommand[] = [];
  protected readonly dialect: Dialect;
  /** Alter blueprints default new columns to nullable. Create is NOT NULL. */
  protected addNullableByDefault = false;

  constructor(dialect: Dialect = dialectFor("sqlite")) {
    this.dialect = dialect;
  }

  protected addColumn(col: LogicalColumn): ColumnBuilder {
    if (col.nullable === undefined) {
      col.nullable = this.addNullableByDefault;
    }
    this.columns.push(col);
    return new ColumnBuilder(col, this);
  }

  uuid(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "uuid" });
  }

  string(name: string, length = 255): ColumnBuilder {
    return this.addColumn({ name, kind: "string", length });
  }

  char(name: string, length = 255): ColumnBuilder {
    return this.addColumn({ name, kind: "char", length });
  }

  text(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "text" });
  }

  mediumText(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "mediumText" });
  }

  longText(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "longText" });
  }

  integer(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "integer" });
  }

  smallInteger(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "smallInteger" });
  }

  bigInteger(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "bigInteger" });
  }

  unsignedBigInteger(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "unsignedBigInteger" });
  }

  /** `{name}` as unsigned big integer (typically a foreign key). */
  foreignId(name: string): ColumnBuilder {
    return this.unsignedBigInteger(name);
  }

  boolean(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "boolean" });
  }

  date(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "date" });
  }

  timestamp(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "timestamp" });
  }

  timestampTz(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "timestampTz" });
  }

  dateTime(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "dateTime" });
  }

  dateTimeTz(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "dateTimeTz" });
  }

  time(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "time" });
  }

  year(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "year" });
  }

  json(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "json" });
  }

  decimal(name: string, precision = 8, scale = 2): ColumnBuilder {
    return this.addColumn({ name, kind: "decimal", precision, scale });
  }

  float(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "float" });
  }

  double(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "double" });
  }

  enum(name: string, values: string[]): ColumnBuilder {
    return this.addColumn({ name, kind: "enum", enumValues: values });
  }

  binary(name: string): ColumnBuilder {
    return this.addColumn({ name, kind: "binary" });
  }

  index(columns: string | string[], name?: string): IndexDefinition {
    const cmd: IndexCommand = {
      type: "index",
      columns: asArray(columns),
      name,
    };
    this.indexes.push(cmd);
    return new IndexDefinition(cmd);
  }

  unique(columns: string | string[], name?: string): IndexDefinition {
    const cmd: IndexCommand = {
      type: "unique",
      columns: asArray(columns),
      name,
    };
    this.indexes.push(cmd);
    return new IndexDefinition(cmd);
  }

  foreign(columns: string | string[], name?: string): ForeignKeyDefinition {
    const cols = asArray(columns);
    const cmd: ForeignCommand = {
      columns: cols,
      name,
      referencesColumn: "id",
    };
    this.foreigns.push(cmd);
    return new ForeignKeyDefinition(cmd);
  }

  indexStatements(table: string): string[] {
    return this.indexes.map((cmd) => compileIndex(this.dialect, table, cmd));
  }
}

/**
 * Fluent table blueprint — column types are logical; SQL is rendered per dialect.
 */
export class Blueprint extends ColumnBlueprint {
  #tablePrimary?: string[];

  id(name = "id"): this {
    this.columns.push({
      name,
      kind: "id",
      primary: true,
      autoIncrement: true,
    });
    return this;
  }

  /** Integer auto-increment PK (`SERIAL` on Postgres). */
  increments(name = "id"): this {
    this.columns.push({
      name,
      kind: "integer",
      primary: true,
      autoIncrement: true,
    });
    return this;
  }

  /** Bigint auto-increment PK (same as `id()`). */
  bigIncrements(name = "id"): this {
    return this.id(name);
  }

  primary(columns: string | string[]): this {
    this.#tablePrimary = asArray(columns);
    return this;
  }

  /**
   * Nullable `created_at` / `updated_at`. The ORM sets values on save
   * (`Model.timestamps = true`); there is no database DEFAULT.
   */
  timestamps(): this {
    this.columns.push({ name: "created_at", kind: "timestamp", nullable: true });
    this.columns.push({ name: "updated_at", kind: "timestamp", nullable: true });
    return this;
  }

  timestampsTz(): this {
    this.columns.push({
      name: "created_at",
      kind: "timestampTz",
      nullable: true,
    });
    this.columns.push({
      name: "updated_at",
      kind: "timestampTz",
      nullable: true,
    });
    return this;
  }

  softDeletes(column = "deleted_at"): this {
    this.columns.push({ name: column, kind: "timestamp", nullable: true });
    return this;
  }

  rememberToken(): ColumnBuilder {
    return this.string("remember_token", 100).nullable();
  }

  /** `{name}_type` + `{name}_id`. */
  morphs(name: string): this {
    this.string(`${name}_type`);
    this.integer(`${name}_id`);
    return this;
  }

  /** Nullable morph columns. */
  nullableMorphs(name: string): this {
    this.string(`${name}_type`).nullable();
    this.integer(`${name}_id`).nullable();
    return this;
  }

  toSql(table: string): string {
    const quoted = this.dialect.quoteIdentifier(table);
    const defs = this.columns.map((c) => this.dialect.columnSql(c));
    if (this.#tablePrimary?.length) {
      const cols = this.#tablePrimary
        .map((name) => this.dialect.quoteIdentifier(name))
        .join(", ");
      defs.push(`PRIMARY KEY (${cols})`);
    }
    for (const fk of this.foreigns) {
      defs.push(compileForeignConstraint(this.dialect, table, fk));
    }
    return `CREATE TABLE ${quoted} (${defs.join(", ")})`;
  }

  toSqlStatements(table: string): string[] {
    return [this.toSql(table), ...this.indexStatements(table)];
  }
}

/**
 * Alter-table blueprint (`Schema.table`).
 */
export class AlterBlueprint extends ColumnBlueprint {
  readonly #drops: string[] = [];
  readonly #renames: Array<{ from: string; to: string }> = [];
  readonly #dropIndexes: string[] = [];
  protected override addNullableByDefault = true;

  dropColumn(name: string): this {
    this.#drops.push(name);
    return this;
  }

  renameColumn(from: string, to: string): this {
    this.#renames.push({ from, to });
    return this;
  }

  dropIndex(name: string): this {
    this.#dropIndexes.push(name);
    return this;
  }

  dropUnique(name: string): this {
    return this.dropIndex(name);
  }

  softDeletes(column = "deleted_at"): this {
    this.timestamp(column).nullable();
    return this;
  }

  toSql(table: string): string[] {
    const quoted = this.dialect.quoteIdentifier(table);
    const q = (name: string) => this.dialect.quoteIdentifier(name);
    const stmts: string[] = [];
    for (const col of this.columns) {
      stmts.push(
        `ALTER TABLE ${quoted} ADD COLUMN ${this.dialect.columnSql(col)}`,
      );
    }
    for (const { from, to } of this.#renames) {
      stmts.push(`ALTER TABLE ${quoted} RENAME COLUMN ${q(from)} TO ${q(to)}`);
    }
    for (const name of this.#drops) {
      stmts.push(`ALTER TABLE ${quoted} DROP COLUMN ${q(name)}`);
    }
    stmts.push(...this.indexStatements(table));
    for (const name of this.#dropIndexes) {
      stmts.push(compileDropIndex(this.dialect, table, name));
    }
    if (this.foreigns.length > 0 && this.dialect.driver === "sqlite") {
      throw new Error(
        "SQLite cannot add foreign keys via ALTER TABLE; include them in create() or schema.raw().",
      );
    }
    for (const fk of this.foreigns) {
      stmts.push(compileAlterForeign(this.dialect, table, fk));
    }
    return stmts;
  }
}

export type SchemaExec = (sql: string) => void | Promise<void>;
export type SchemaQuery = (
  sql: string,
  params?: unknown[],
) =>
  | Record<string, unknown>
  | null
  | undefined
  | Promise<Record<string, unknown> | null | undefined>;
export type SchemaQueryAll = (
  sql: string,
  params?: unknown[],
) => Record<string, unknown>[] | Promise<Record<string, unknown>[]>;

/**
 * Schema builder bound to a connection.
 */
export class Schema {
  #dialect: Dialect;
  #connection: Connection | null;

  constructor(
    private execFn: SchemaExec,
    private query?: SchemaQuery,
    private all?: SchemaQueryAll,
    dialect: Dialect = dialectFor("sqlite"),
    connection: Connection | null = null,
  ) {
    this.#connection = connection;
    this.#dialect = connection?.dialect ?? dialect;
  }

  get dialect(): Dialect {
    return this.#connection?.dialect ?? this.#dialect;
  }

  /** Connection this schema builder is bound to. */
  getConnection(): Connection {
    if (!this.#connection) {
      throw new Error("No connection has been set on the schema builder.");
    }
    return this.#connection;
  }

  /** Bind a different connection to this schema builder. */
  setConnection(connection: Connection): this {
    this.#connection = connection;
    this.#dialect = connection.dialect;
    return this;
  }

  async create(
    table: string,
    callback: (blueprint: Blueprint) => void,
  ): Promise<void> {
    const blueprint = new Blueprint(this.dialect);
    callback(blueprint);
    for (const sql of blueprint.toSqlStatements(table)) {
      await this.execFn(sql);
    }
  }

  /** Alter an existing table (add / rename / drop columns). */
  async table(
    table: string,
    callback: (blueprint: AlterBlueprint) => void,
  ): Promise<void> {
    const blueprint = new AlterBlueprint(this.dialect);
    callback(blueprint);
    for (const sql of blueprint.toSql(table)) {
      await this.execFn(sql);
    }
  }

  async dropIfExists(table: string): Promise<void> {
    await this.execFn(
      `DROP TABLE IF EXISTS ${this.dialect.quoteIdentifier(table)}`,
    );
  }

  /** `Schema.drop`. */
  async drop(table: string): Promise<void> {
    await this.execFn(`DROP TABLE ${this.dialect.quoteIdentifier(table)}`);
  }

  /** `Schema.rename`. */
  async rename(from: string, to: string): Promise<void> {
    await this.execFn(
      `ALTER TABLE ${this.dialect.quoteIdentifier(from)} RENAME TO ${this.dialect.quoteIdentifier(to)}`,
    );
  }

  async hasTable(table: string): Promise<boolean> {
    if (!this.query) {
      throw new Error("Schema.hasTable() requires a query function.");
    }
    const { sql, params } = this.dialect.hasTableSql(table);
    const row = await this.query(sql, params);
    return row != null;
  }

  async hasColumn(table: string, column: string): Promise<boolean> {
    if (!this.all) {
      throw new Error("Schema.hasColumn() requires an all() query function.");
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name [${table}].`);
    }
    const { sql, params, columnKey } = this.dialect.hasColumnSql(table);
    const rows = await this.all(sql, params);
    return rows.some((r) => String(r[columnKey]) === column);
  }

  /** True when every listed column exists on the table. */
  async hasColumns(table: string, columns: string[]): Promise<boolean> {
    for (const column of columns) {
      if (!(await this.hasColumn(table, column))) return false;
    }
    return true;
  }

  /** Column names for a table. */
  async getColumnListing(table: string): Promise<string[]> {
    if (!this.all) {
      throw new Error(
        "Schema.getColumnListing() requires an all() query function.",
      );
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`Invalid table name [${table}].`);
    }
    const { sql, params, columnKey } = this.dialect.hasColumnSql(table);
    const rows = await this.all(sql, params);
    return rows.map((r) => String(r[columnKey]));
  }

  async disableForeignKeyConstraints(): Promise<void> {
    const driver = this.dialect.driver;
    if (driver === "sqlite") {
      await this.execFn("PRAGMA foreign_keys = OFF");
    } else if (isMysqlFamily(driver)) {
      await this.execFn("SET FOREIGN_KEY_CHECKS=0");
    } else if (driver === "sqlsrv") {
      const sql = this.dialect.disableForeignKeysSql();
      if (sql) await this.execFn(sql);
    } else {
      await this.execFn("SET CONSTRAINTS ALL DEFERRED");
    }
  }

  async enableForeignKeyConstraints(): Promise<void> {
    const driver = this.dialect.driver;
    if (driver === "sqlite") {
      await this.execFn("PRAGMA foreign_keys = ON");
    } else if (isMysqlFamily(driver)) {
      await this.execFn("SET FOREIGN_KEY_CHECKS=1");
    } else if (driver === "sqlsrv") {
      const sql = this.dialect.enableForeignKeysSql();
      if (sql) await this.execFn(sql);
    } else {
      await this.execFn("SET CONSTRAINTS ALL IMMEDIATE");
    }
  }

  async withoutForeignKeyConstraints(
    callback: () => void | Promise<void>,
  ): Promise<void> {
    await this.disableForeignKeyConstraints();
    try {
      await callback();
    } finally {
      await this.enableForeignKeyConstraints();
    }
  }

  /**
   * Run raw DDL/SQL on this connection.
   * Prefer `DB.statement()` / `DB.unprepared()` for app code.
   */
  async raw(sql: string): Promise<void> {
    await this.execFn(sql);
  }
}

/** Build a Schema bound to a Connection. */
export function schemaFor(connection: Connection): Schema {
  return new Schema(
    (sql) => connection.exec(sql),
    (sql, params) => connection.get(sql, params),
    (sql, params) => connection.all(sql, params),
    connection.dialect,
    connection,
  );
}
