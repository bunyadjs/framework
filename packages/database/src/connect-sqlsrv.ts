import {
  attachConnectionContract,
  databaseNameFromOptions,
  type Connection,
  type SqlsrvOptions,
} from "./connection-contract.ts";
import { afterCommit } from "./after-commit.ts";
import { dialectFor } from "./dialect.ts";

function delegateSqlsrvConnection(options: SqlsrvOptions): Connection {
  let inner: Connection | undefined;
  let loading: Promise<Connection> | undefined;

  const load = (): Promise<Connection> => {
    if (inner) return Promise.resolve(inner);
    if (!loading) {
      loading = import("./sqlsrv-connection.ts").then((mod) => {
        inner = mod.connectSqlsrv(options);
        return inner;
      });
    }
    return loading;
  };

  const dialect = dialectFor("sqlsrv");
  const database = databaseNameFromOptions(options, "bunyad");
  return attachConnectionContract(
    {
      driver: "sqlsrv",
      dialect,
      raw: undefined,
      async run(query, params) {
        return (await load()).run(query, params);
      },
      async get(query, params) {
        return (await load()).get(query, params);
      },
      async all(query, params) {
        return (await load()).all(query, params);
      },
      async exec(query) {
        return (await load()).exec(query);
      },
      async insertGetId(table, columns, values, idColumn) {
        return (await load()).insertGetId(table, columns, values, idColumn);
      },
      async close() {
        if (inner) await inner.close();
      },
      afterCommit(callback) {
        afterCommit(callback);
      },
      async beginTransaction() {
        return (await load()).beginTransaction();
      },
      async commit() {
        return (await load()).commit();
      },
      async rollBack() {
        return (await load()).rollBack();
      },
      async transaction(callback) {
        return (await load()).transaction(callback);
      },
    },
    { database, config: { ...options, driver: "sqlsrv", database } },
  );
}

/** Open a SQL Server connection (driver loads on first query). */
export function connectSqlsrv(options: SqlsrvOptions = {}): Connection {
  return delegateSqlsrvConnection(options);
}
