import type {
  Connection,
  DatabaseConfig,
  DatabaseConfigBase,
  MariadbOptions,
  MysqlOptions,
  PostgresOptions,
  ReplicaHostConfig,
  SqliteOptions,
  SqlsrvOptions,
} from "./connection-contract.ts";
import { createReadWriteConnection } from "./read-write-connection.ts";

export type DriverConnectors = {
  sqlite: (options: SqliteOptions) => Connection;
  postgres: (options: PostgresOptions) => Connection;
  mysql: (options: MysqlOptions) => Connection;
  mariadb: (options: MariadbOptions) => Connection;
  sqlsrv: (options: SqlsrvOptions) => Connection;
};

function pickReplicaHost(
  hosts: ReplicaHostConfig | ReplicaHostConfig[] | undefined,
): ReplicaHostConfig | undefined {
  if (!hosts) return undefined;
  if (Array.isArray(hosts)) {
    if (hosts.length === 0) return undefined;
    return hosts[Math.floor(Math.random() * hosts.length)]!;
  }
  return hosts;
}

function stripReadWrite(config: DatabaseConfig): DatabaseConfigBase {
  const { read: _r, write: _w, sticky: _s, ...base } = config;
  return base as DatabaseConfigBase;
}

function mergeReplicaHost(
  base: DatabaseConfigBase,
  host: ReplicaHostConfig | undefined,
): DatabaseConfigBase {
  if (!host) return base;
  return { ...base, ...host } as DatabaseConfigBase;
}

function connectSingle(
  connectors: DriverConnectors,
  config: DatabaseConfigBase,
): Connection {
  switch (config.driver) {
    case "sqlite":
      return connectors.sqlite(config);
    case "postgres":
    case "pgsql":
      return connectors.postgres(config);
    case "mysql":
      return connectors.mysql(config);
    case "mariadb":
      return connectors.mariadb(config);
    case "sqlsrv":
      return connectors.sqlsrv(config);
  }
}

/** Open a connection from a config object (supports optional read/write hosts). */
export function connectWith(
  connectors: DriverConnectors,
  config: DatabaseConfig,
): Connection {
  const hasReplicas = config.read != null || config.write != null;
  if (!hasReplicas) {
    return connectSingle(connectors, stripReadWrite(config));
  }

  const base = stripReadWrite(config);
  const writeHost = pickReplicaHost(config.write);
  const readHost = pickReplicaHost(config.read);
  const writeConfig = mergeReplicaHost(base, writeHost);
  const readConfig = mergeReplicaHost(base, readHost ?? writeHost);

  const write = connectSingle(connectors, writeConfig);
  // Same sqlite :memory: path would still be two separate DBs; always open read.
  const read =
    readHost == null && writeHost == null
      ? write
      : connectSingle(connectors, readConfig);

  if (read === write) return write;

  return createReadWriteConnection(write, read, {
    sticky: config.sticky !== false,
  });
}
