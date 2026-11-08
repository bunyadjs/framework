import type { Application } from "@bunyad/core";
import type { DatabaseConfig } from "@bunyad/database";

export type RedisConnectionConfig = {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  database?: string | number;
};

export type DatabaseConnectionsConfig = {
  default: string;
  connections: Record<string, DatabaseConfig>;
  /**
   * Named connections to migrate on boot.
   * Defaults to `[default]` so unused MySQL/Postgres/SQL Server entries are not contacted.
   */
  migrate?: string[];
  /** Redis clients used by cache / queue / broadcasting / sessions. */
  redis?: Record<string, RedisConnectionConfig>;
};

function envUrl(): string | undefined {
  return process.env.DB_URL ?? process.env.DATABASE_URL;
}

/** MySQL connection settings from env. */
export function mysqlConnectionFromEnv(): DatabaseConfig {
  const url = envUrl();
  if (url) return { driver: "mysql", url };
  return {
    driver: "mysql",
    hostname: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_DATABASE ?? "bunyad",
    username: process.env.DB_USERNAME ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    max: Number(process.env.DB_POOL_MAX ?? 10),
  };
}

/** MariaDB connection settings from env (Bun `mariadb` adapter). */
export function mariadbConnectionFromEnv(): DatabaseConfig {
  const url = envUrl();
  if (url) return { driver: "mariadb", url };
  return {
    driver: "mariadb",
    hostname: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_DATABASE ?? "bunyad",
    username: process.env.DB_USERNAME ?? "root",
    password: process.env.DB_PASSWORD ?? "",
    max: Number(process.env.DB_POOL_MAX ?? 10),
  };
}

/** Postgres connection settings from env. */
export function pgsqlConnectionFromEnv(): DatabaseConfig {
  const url = envUrl();
  if (url) return { driver: "pgsql", url };
  return {
    driver: "pgsql",
    hostname: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_DATABASE ?? "bunyad",
    username: process.env.DB_USERNAME ?? "postgres",
    password: process.env.DB_PASSWORD ?? "",
    max: Number(process.env.DB_POOL_MAX ?? 10),
  };
}

/** SQL Server connection settings from env (`mssql` / Tedious). */
export function sqlsrvConnectionFromEnv(): DatabaseConfig {
  const url = envUrl();
  if (url) return { driver: "sqlsrv", url };
  return {
    driver: "sqlsrv",
    hostname: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 1433),
    database: process.env.DB_DATABASE ?? "bunyad",
    username: process.env.DB_USERNAME ?? "sa",
    password: process.env.DB_PASSWORD ?? "",
    encrypt: process.env.DB_ENCRYPT !== "false",
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
    max: Number(process.env.DB_POOL_MAX ?? 10),
  };
}

/** Standard named connections (sqlite / mysql / mariadb / pgsql / sqlsrv). */
export function standardDatabaseConnections(
  databasePath: (path?: string) => string,
): Record<string, DatabaseConfig> {
  return {
    sqlite: {
      driver: "sqlite",
      path:
        process.env.DATABASE_PATH ??
        process.env.DB_DATABASE ??
        databasePath("database.sqlite"),
    },
    mysql: mysqlConnectionFromEnv(),
    mariadb: mariadbConnectionFromEnv(),
    pgsql: pgsqlConnectionFromEnv(),
    sqlsrv: sqlsrvConnectionFromEnv(),
  };
}

export function defaultRedisConfig(): Record<string, RedisConnectionConfig> {
  const url = process.env.REDIS_URL;
  return {
    default: {
      url,
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD,
      database: process.env.REDIS_DB ?? "0",
    },
    cache: {
      url,
      host: process.env.REDIS_HOST ?? "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD,
      database: process.env.REDIS_CACHE_DB ?? "1",
    },
  };
}

/** Resolve Redis URL from `database.redis` config or `REDIS_URL`. */
export function resolveRedisUrl(
  app: Application,
  name = "default",
): string | undefined {
  const redis = app.config.get<DatabaseConnectionsConfig>("database")?.redis;
  const entry = redis?.[name] ?? redis?.default;
  return entry?.url ?? process.env.REDIS_URL;
}

/** Map env aliases onto named connections in `config/database.ts`. */
export function normalizeConnectionName(name: string): string {
  const key = name.toLowerCase();
  if (key === "postgres" || key === "postgresql" || key === "pgsql") {
    return "pgsql";
  }
  if (key === "mariadb") return "mariadb";
  if (key === "mssql" || key === "sqlserver" || key === "sqlsrv") {
    return "sqlsrv";
  }
  return name;
}

/** Default when app has no `config/database.ts`. */
export function defaultDatabaseConfig(
  databasePath: (path?: string) => string,
): DatabaseConnectionsConfig {
  return {
    default: normalizeConnectionName(process.env.DB_CONNECTION ?? "sqlite"),
    connections: standardDatabaseConnections(databasePath),
    redis: defaultRedisConfig(),
  };
}

export function resolveDatabaseConfig(
  app: Application,
): DatabaseConnectionsConfig {
  const fromApp = app.config.get<DatabaseConnectionsConfig>("database");
  if (fromApp?.connections) {
    return {
      ...fromApp,
      default: normalizeConnectionName(fromApp.default),
      migrate: fromApp.migrate?.map(normalizeConnectionName),
    };
  }
  return defaultDatabaseConfig((path = "") => app.databasePath(path));
}
