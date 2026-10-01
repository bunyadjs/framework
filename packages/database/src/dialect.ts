export type DriverName = "sqlite" | "postgres" | "mysql" | "mariadb" | "sqlsrv";

/** MySQL and MariaDB share most grammar. */
export function isMysqlFamily(driver: DriverName): boolean {
  return driver === "mysql" || driver === "mariadb";
}

export type ColumnKind =
  | "id"
  | "string"
  | "char"
  | "text"
  | "mediumText"
  | "longText"
  | "integer"
  | "smallInteger"
  | "bigInteger"
  | "unsignedBigInteger"
  | "boolean"
  | "timestamp"
  | "timestampTz"
  | "dateTime"
  | "dateTimeTz"
  | "date"
  | "time"
  | "year"
  | "uuid"
  | "json"
  | "decimal"
  | "float"
  | "double"
  | "enum"
  | "binary";

export type LogicalColumn = {
  name: string;
  kind: ColumnKind;
  length?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
  primary?: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  nullable?: boolean;
  defaultValue?: string | number | boolean | null;
  /** Unquoted SQL default (`NOW()`, `(CURRENT_TIMESTAMP)`). */
  rawDefault?: string;
  /** Default `CURRENT_TIMESTAMP` / dialect equivalent. */
  useCurrent?: boolean;
};

/**
 * SQL dialect differences across SQLite / PostgreSQL / MySQL / MariaDB / SQL Server.
 */
export type Dialect = {
  readonly driver: DriverName;
  /** Convert `?` placeholders to driver style (Postgres `$1`, SQL Server `@p0`). */
  bindSql(sql: string): string;
  quoteIdentifier(name: string): string;
  columnSql(column: LogicalColumn): string;
  migrationsTableSql(): string;
  listTablesSql(): { sql: string; params?: unknown[] };
  hasTableSql(table: string): { sql: string; params: unknown[] };
  hasColumnSql(table: string): { sql: string; params?: unknown[]; columnKey: string };
  disableForeignKeysSql(): string | null;
  enableForeignKeysSql(): string | null;
  /** How to obtain the last insert id after a plain INSERT. */
  insertIdStrategy:
    | "last_insert_rowid"
    | "returning"
    | "lastInsertRowid"
    | "output";
};

function formatDefault(
  dialect: DriverName,
  value: string | number | boolean | null,
): string {
  if (value === null) return "NULL";
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  if (typeof value === "boolean") {
    if (dialect === "postgres") return value ? "TRUE" : "FALSE";
    if (dialect === "sqlsrv") return value ? "1" : "0";
    return value ? "1" : "0";
  }
  return String(value);
}

function currentTimestampSql(driver: DriverName): string {
  if (driver === "sqlsrv") return "GETDATE()";
  if (driver === "sqlite") return "(CURRENT_TIMESTAMP)";
  return "CURRENT_TIMESTAMP";
}

function columnDefaultSql(driver: DriverName, column: LogicalColumn): string {
  if (column.defaultValue !== undefined) {
    return ` DEFAULT ${formatDefault(driver, column.defaultValue)}`;
  }
  if (column.rawDefault) {
    return ` DEFAULT ${column.rawDefault}`;
  }
  if (column.useCurrent) {
    return ` DEFAULT ${currentTimestampSql(driver)}`;
  }
  return "";
}

/**
 * Quote a SQL name (column/table). Leaves expressions, aliases, `*`, and
 * already-quoted identifiers alone so reserved words like `order` are safe.
 */
export function wrapSqlName(
  dialect: Pick<Dialect, "quoteIdentifier">,
  name: string,
): string {
  const trimmed = name.trim();
  if (
    trimmed === "*" ||
    trimmed.includes("(") ||
    trimmed.includes(" ") ||
    trimmed.includes("'") ||
    trimmed.includes('"') ||
    trimmed.includes("`") ||
    trimmed.includes("[")
  ) {
    return name;
  }
  if (trimmed.includes(".")) {
    return trimmed
      .split(".")
      .map((part) =>
        part === "*" ? "*" : dialect.quoteIdentifier(part),
      )
      .join(".");
  }
  return dialect.quoteIdentifier(trimmed);
}

function bindQuestionToDollar(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function bindQuestionToAtParams(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `@p${index++}`);
}

const sqliteDialect: Dialect = {
  driver: "sqlite",
  bindSql: (sql) => sql,
  quoteIdentifier: (name) => `"${name.replaceAll('"', '""')}"`,
  insertIdStrategy: "last_insert_rowid",
  columnSql(column) {
    let type: string;
    switch (column.kind) {
      case "id":
      case "integer":
      case "smallInteger":
      case "bigInteger":
      case "unsignedBigInteger":
      case "boolean":
      case "year":
        type = "INTEGER";
        break;
      case "string":
      case "char":
      case "text":
      case "mediumText":
      case "longText":
      case "timestamp":
      case "timestampTz":
      case "dateTime":
      case "dateTimeTz":
      case "date":
      case "time":
      case "uuid":
      case "json":
      case "decimal":
      case "float":
      case "double":
      case "enum":
      case "binary":
        type = "TEXT";
        break;
    }
    let sql = `${this.quoteIdentifier(column.name)} ${type}`;
    if (column.primary) sql += " PRIMARY KEY";
    if (column.autoIncrement) sql += " AUTOINCREMENT";
    if (column.unique) sql += " UNIQUE";
    if (column.nullable === false) sql += " NOT NULL";
    sql += columnDefaultSql("sqlite", column);
    return sql;
  },
  migrationsTableSql: () => `
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration TEXT NOT NULL UNIQUE,
      batch INTEGER NOT NULL
    )
  `,
  listTablesSql: () => ({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  }),
  hasTableSql: (table) => ({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    params: [table],
  }),
  hasColumnSql: (table) => ({
    sql: `PRAGMA table_info(${table})`,
    columnKey: "name",
  }),
  disableForeignKeysSql: () => "PRAGMA foreign_keys = OFF",
  enableForeignKeysSql: () => "PRAGMA foreign_keys = ON",
};

const postgresDialect: Dialect = {
  driver: "postgres",
  bindSql: bindQuestionToDollar,
  quoteIdentifier: (name) => `"${name.replaceAll('"', '""')}"`,
  insertIdStrategy: "returning",
  columnSql(column) {
    let type: string;
    switch (column.kind) {
      case "id":
        type = "BIGSERIAL";
        break;
      case "integer":
        type = column.autoIncrement ? "SERIAL" : "INTEGER";
        break;
      case "smallInteger":
        type = "SMALLINT";
        break;
      case "bigInteger":
      case "unsignedBigInteger":
        type = "BIGINT";
        break;
      case "boolean":
        type = "BOOLEAN";
        break;
      case "string":
        type = `VARCHAR(${column.length ?? 255})`;
        break;
      case "char":
        type = `CHAR(${column.length ?? 255})`;
        break;
      case "text":
      case "mediumText":
      case "longText":
        type = "TEXT";
        break;
      case "timestamp":
      case "dateTime":
        type = "TIMESTAMP";
        break;
      case "timestampTz":
      case "dateTimeTz":
        type = "TIMESTAMPTZ";
        break;
      case "date":
        type = "DATE";
        break;
      case "time":
        type = "TIME";
        break;
      case "year":
        type = "SMALLINT";
        break;
      case "uuid":
        type = "UUID";
        break;
      case "json":
        type = "JSONB";
        break;
      case "decimal":
        type = `DECIMAL(${column.precision ?? 8}, ${column.scale ?? 2})`;
        break;
      case "float":
        type = "REAL";
        break;
      case "double":
        type = "DOUBLE PRECISION";
        break;
      case "enum":
        type = "TEXT";
        break;
      case "binary":
        type = "BYTEA";
        break;
    }
    let sql = `${this.quoteIdentifier(column.name)} ${type}`;
    if (column.primary) sql += " PRIMARY KEY";
    if (column.unique) sql += " UNIQUE";
    if (column.nullable === false) sql += " NOT NULL";
    sql += columnDefaultSql("postgres", column);
    if (column.kind === "enum" && column.enumValues?.length) {
      const list = column.enumValues
        .map((v) => `'${v.replaceAll("'", "''")}'`)
        .join(", ");
      sql += ` CHECK (${this.quoteIdentifier(column.name)} IN (${list}))`;
    }
    return sql;
  },
  migrationsTableSql: () => `
    CREATE TABLE IF NOT EXISTS migrations (
      id BIGSERIAL PRIMARY KEY,
      migration VARCHAR(255) NOT NULL UNIQUE,
      batch INTEGER NOT NULL
    )
  `,
  listTablesSql: () => ({
    sql: `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
  }),
  hasTableSql: (table) => ({
    sql: `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
    params: [table],
  }),
  hasColumnSql: (table) => ({
    sql: `SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
    params: [table],
    columnKey: "name",
  }),
  disableForeignKeysSql: () => null,
  enableForeignKeysSql: () => null,
};

const mysqlDialect: Dialect = {
  driver: "mysql",
  bindSql: (sql) => sql,
  quoteIdentifier: (name) => `\`${name.replaceAll("`", "``")}\``,
  insertIdStrategy: "lastInsertRowid",
  columnSql(column) {
    let type: string;
    switch (column.kind) {
      case "id":
        type = "BIGINT";
        break;
      case "integer":
        type = "INT";
        break;
      case "smallInteger":
        type = "SMALLINT";
        break;
      case "bigInteger":
        type = "BIGINT";
        break;
      case "unsignedBigInteger":
        type = "BIGINT UNSIGNED";
        break;
      case "boolean":
        type = "TINYINT(1)";
        break;
      case "string":
        type = `VARCHAR(${column.length ?? 255})`;
        break;
      case "char":
        type = `CHAR(${column.length ?? 255})`;
        break;
      case "text":
        type = "TEXT";
        break;
      case "mediumText":
        type = "MEDIUMTEXT";
        break;
      case "longText":
        type = "LONGTEXT";
        break;
      case "timestamp":
      case "dateTime":
        type = "DATETIME";
        break;
      case "timestampTz":
      case "dateTimeTz":
        type = "TIMESTAMP";
        break;
      case "date":
        type = "DATE";
        break;
      case "time":
        type = "TIME";
        break;
      case "year":
        type = "YEAR";
        break;
      case "uuid":
        type = "CHAR(36)";
        break;
      case "json":
        type = "JSON";
        break;
      case "decimal":
        type = `DECIMAL(${column.precision ?? 8}, ${column.scale ?? 2})`;
        break;
      case "float":
        type = "FLOAT";
        break;
      case "double":
        type = "DOUBLE";
        break;
      case "enum": {
        const list = (column.enumValues ?? [])
          .map((v) => `'${v.replaceAll("'", "''")}'`)
          .join(", ");
        type = `ENUM(${list})`;
        break;
      }
      case "binary":
        type = "BLOB";
        break;
    }
    let sql = `${this.quoteIdentifier(column.name)} ${type}`;
    if (column.primary) sql += " PRIMARY KEY";
    if (column.autoIncrement || column.kind === "id") sql += " AUTO_INCREMENT";
    if (column.unique) sql += " UNIQUE";
    if (column.nullable === false) sql += " NOT NULL";
    sql += columnDefaultSql("mysql", column);
    return sql;
  },
  migrationsTableSql: () => `
    CREATE TABLE IF NOT EXISTS migrations (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      migration VARCHAR(255) NOT NULL UNIQUE,
      batch INT NOT NULL
    )
  `,
  listTablesSql: () => ({
    sql: `SELECT table_name AS name FROM information_schema.tables
          WHERE table_schema = DATABASE()`,
  }),
  hasTableSql: (table) => ({
    sql: `SELECT table_name AS name FROM information_schema.tables
          WHERE table_schema = DATABASE() AND table_name = ?`,
    params: [table],
  }),
  hasColumnSql: (table) => ({
    sql: `SELECT column_name AS name FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ?`,
    params: [table],
    columnKey: "name",
  }),
  disableForeignKeysSql: () => "SET FOREIGN_KEY_CHECKS = 0",
  enableForeignKeysSql: () => "SET FOREIGN_KEY_CHECKS = 1",
};

/** MariaDB — MySQL-compatible grammar via Bun's `mariadb` adapter. */
const mariadbDialect: Dialect = {
  ...mysqlDialect,
  driver: "mariadb",
  columnSql(column) {
    return mysqlDialect.columnSql(column);
  },
};

/**
 * Microsoft SQL Server (sqlsrv) — Laravel SQL Server grammar subset.
 * Connected via the `mssql` (Tedious) driver; Bun SQL has no native adapter yet.
 */
const sqlsrvDialect: Dialect = {
  driver: "sqlsrv",
  bindSql: bindQuestionToAtParams,
  quoteIdentifier: (name) => `[${name.replaceAll("]", "]]")}]`,
  insertIdStrategy: "output",
  columnSql(column) {
    let type: string;
    switch (column.kind) {
      case "id":
      case "bigInteger":
      case "unsignedBigInteger":
        type = "BIGINT";
        break;
      case "integer":
        type = "INT";
        break;
      case "smallInteger":
        type = "SMALLINT";
        break;
      case "boolean":
        type = "BIT";
        break;
      case "string":
        type = `NVARCHAR(${column.length ?? 255})`;
        break;
      case "char":
        type = `NCHAR(${column.length ?? 255})`;
        break;
      case "text":
      case "mediumText":
      case "longText":
      case "json":
        type = "NVARCHAR(MAX)";
        break;
      case "timestamp":
      case "dateTime":
        type = "DATETIME2";
        break;
      case "timestampTz":
      case "dateTimeTz":
        type = "DATETIMEOFFSET";
        break;
      case "date":
        type = "DATE";
        break;
      case "time":
        type = "TIME";
        break;
      case "year":
        type = "SMALLINT";
        break;
      case "uuid":
        type = "UNIQUEIDENTIFIER";
        break;
      case "decimal":
        type = `DECIMAL(${column.precision ?? 8}, ${column.scale ?? 2})`;
        break;
      case "float":
        type = "REAL";
        break;
      case "double":
        type = "FLOAT";
        break;
      case "enum":
        type = "NVARCHAR(255)";
        break;
      case "binary":
        type = "VARBINARY(MAX)";
        break;
    }
    let sql = `${this.quoteIdentifier(column.name)} ${type}`;
    if (column.primary) sql += " PRIMARY KEY";
    if (column.autoIncrement || column.kind === "id") {
      sql += " IDENTITY(1,1)";
    }
    if (column.unique) sql += " UNIQUE";
    if (column.nullable === false) sql += " NOT NULL";
    sql += columnDefaultSql("sqlsrv", column);
    return sql;
  },
  migrationsTableSql: () => `
    IF OBJECT_ID(N'migrations', N'U') IS NULL
    CREATE TABLE migrations (
      id BIGINT IDENTITY(1,1) PRIMARY KEY,
      migration NVARCHAR(255) NOT NULL UNIQUE,
      batch INT NOT NULL
    )
  `,
  listTablesSql: () => ({
    sql: `SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE = 'BASE TABLE'`,
  }),
  hasTableSql: (table) => ({
    sql: `SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME = ?`,
    params: [table],
  }),
  hasColumnSql: (table) => ({
    sql: `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_NAME = ?`,
    params: [table],
    columnKey: "name",
  }),
  disableForeignKeysSql: () =>
    "EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'",
  enableForeignKeysSql: () =>
    "EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'",
};

export function dialectFor(driver: DriverName): Dialect {
  switch (driver) {
    case "sqlite":
      return sqliteDialect;
    case "postgres":
      return postgresDialect;
    case "mysql":
      return mysqlDialect;
    case "mariadb":
      return mariadbDialect;
    case "sqlsrv":
      return sqlsrvDialect;
  }
}
