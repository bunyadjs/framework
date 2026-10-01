import {
  type Connection,
  type DatabaseConfig,
} from "./connection-contract.ts";
import { connectWith } from "./connection-factory.ts";
import { configFromEnv } from "./config-from-env.ts";
import { connectSqlsrv } from "./connect-sqlsrv.ts";
import {
  connectPostgres,
  connectMysql,
  connectMariadb,
  connectSqlite,
} from "./drivers/node/index.ts";

export {
  affectedRowsFromResult,
  attachConnectionContract,
  databaseNameFromOptions,
  driverNameOf,
  type Connection,
  type ConnectionIdentity,
  type DatabaseConfig,
  type DatabaseConfigBase,
  type MariadbOptions,
  type MysqlOptions,
  type PostgresOptions,
  type ReadWriteConfig,
  type ReplicaHostConfig,
  type SqliteOptions,
  type SqlsrvOptions,
} from "./connection-contract.ts";

export {
  connectPostgres,
  connectMysql,
  connectMariadb,
  connectSqlite,
  loadPg,
  loadMysql2,
  loadBetterSqlite3,
  sanitizePostgresUrl,
  postgresConnectionUrl,
} from "./drivers/node/index.ts";

export { connectSqlsrv } from "./connect-sqlsrv.ts";
export { configFromEnv } from "./config-from-env.ts";

const nodeConnectors = {
  sqlite: connectSqlite,
  postgres: connectPostgres,
  mysql: connectMysql,
  mariadb: connectMariadb,
  sqlsrv: connectSqlsrv,
};

/** Open a connection from a config object (Node drivers). */
export function connect(config: DatabaseConfig): Connection {
  return connectWith(nodeConnectors, config);
}

/** Open a connection using `DB_*` environment variables (Node drivers). */
export function connectFromEnv(
  env: Record<string, string | undefined> = process.env,
): Connection {
  return connect(configFromEnv(env));
}
