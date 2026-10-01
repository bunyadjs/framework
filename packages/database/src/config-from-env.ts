import type { DatabaseConfig } from "./connection-contract.ts";

/**
 * Resolve database config from environment.
 *
 * `DB_CONNECTION` = sqlite | pgsql | mysql | mariadb | sqlsrv (default: sqlite)
 */
export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const driver = (env.DB_CONNECTION ?? "sqlite").toLowerCase();
  const url = env.DB_URL ?? env.DATABASE_URL;

  if (driver === "pgsql" || driver === "postgresql" || driver === "postgres") {
    if (url) return { driver: "pgsql", url };
    return {
      driver: "pgsql",
      hostname: env.DB_HOST ?? "127.0.0.1",
      port: env.DB_PORT ? Number(env.DB_PORT) : 5432,
      database: env.DB_DATABASE ?? "bunyad",
      username: env.DB_USERNAME ?? "postgres",
      password: env.DB_PASSWORD ?? "",
    };
  }

  if (driver === "mysql") {
    if (url) return { driver: "mysql", url };
    return {
      driver: "mysql",
      hostname: env.DB_HOST ?? "127.0.0.1",
      port: env.DB_PORT ? Number(env.DB_PORT) : 3306,
      database: env.DB_DATABASE ?? "bunyad",
      username: env.DB_USERNAME ?? "root",
      password: env.DB_PASSWORD ?? "",
    };
  }

  if (driver === "mariadb") {
    if (url) return { driver: "mariadb", url };
    return {
      driver: "mariadb",
      hostname: env.DB_HOST ?? "127.0.0.1",
      port: env.DB_PORT ? Number(env.DB_PORT) : 3306,
      database: env.DB_DATABASE ?? "bunyad",
      username: env.DB_USERNAME ?? "root",
      password: env.DB_PASSWORD ?? "",
    };
  }

  if (driver === "sqlsrv" || driver === "mssql" || driver === "sqlserver") {
    if (url) return { driver: "sqlsrv", url };
    return {
      driver: "sqlsrv",
      hostname: env.DB_HOST ?? "127.0.0.1",
      port: env.DB_PORT ? Number(env.DB_PORT) : 1433,
      database: env.DB_DATABASE ?? "bunyad",
      username: env.DB_USERNAME ?? "sa",
      password: env.DB_PASSWORD ?? "",
      encrypt: env.DB_ENCRYPT !== "false",
      trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE !== "false",
    };
  }

  return {
    driver: "sqlite",
    path: env.DATABASE_PATH ?? env.DB_DATABASE ?? ":memory:",
  };
}
