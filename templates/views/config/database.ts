import type { DatabaseConnectionsConfig } from "@bunyad/framework";

export type { DatabaseConnectionsConfig };

/**
 * Database config.
 * Drivers: sqlite, mysql, mariadb, pgsql, sqlsrv.
 * Unused drivers stay lazy; only `default` (+ optional `migrate`) open on boot.
 */
export default function database(
  databasePath: (path?: string) => string,
): DatabaseConnectionsConfig {
  return {
    default: process.env.DB_CONNECTION ?? "sqlite",

    connections: {
      sqlite: {
        driver: "sqlite",
        path:
          process.env.DATABASE_PATH ??
          process.env.DB_DATABASE ??
          databasePath("database.sqlite"),
      },

      mysql: {
        driver: "mysql",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 3306),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },

      mariadb: {
        driver: "mariadb",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 3306),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },

      pgsql: {
        driver: "pgsql",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "postgres",
        password: process.env.DB_PASSWORD ?? "",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },

      sqlsrv: {
        driver: "sqlsrv",
        url: process.env.DB_URL ?? process.env.DATABASE_URL,
        hostname: process.env.DB_HOST ?? "127.0.0.1",
        port: Number(process.env.DB_PORT ?? 1433),
        database: process.env.DB_DATABASE ?? "bunyad",
        username: process.env.DB_USERNAME ?? "sa",
        password: process.env.DB_PASSWORD ?? "",
        encrypt: process.env.DB_ENCRYPT !== "false",
        trustServerCertificate:
          process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
        max: Number(process.env.DB_POOL_MAX ?? 10),
      },
    },

    redis: {
      default: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD,
        database: process.env.REDIS_DB ?? "0",
      },
      cache: {
        url: process.env.REDIS_URL,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD,
        database: process.env.REDIS_CACHE_DB ?? "1",
      },
    },
  };
}
