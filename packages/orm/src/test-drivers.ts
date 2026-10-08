/**
 * Real-database test harness: SQLite always; Postgres / MySQL when reachable.
 * Set BUNYAD_TEST_POSTGRES_URL and/or BUNYAD_TEST_MYSQL_URL to enable them.
 */
import {
  connectMysql,
  connectPostgres,
  connectSqlite,
  type Connection,
} from "@bunyad/database";

export interface TestDriver {
  name: "sqlite" | "postgres" | "mysql";
  connection: Connection;
}

async function reachable(connection: Connection): Promise<boolean> {
  try {
    await connection.exec("SELECT 1");
    return true;
  } catch {
    try {
      await connection.close();
    } catch {
      /* ignore */
    }
    return false;
  }
}

export async function testDrivers(): Promise<TestDriver[]> {
  const drivers: TestDriver[] = [
    { name: "sqlite", connection: connectSqlite() },
  ];
  const pg = Bun.env.BUNYAD_TEST_POSTGRES_URL ?? Bun.env.DATABASE_URL;
  if (pg && /^(postgres|postgresql):\/\//i.test(pg)) {
    const connection = connectPostgres({ url: pg, max: 2 });
    if (await reachable(connection)) drivers.push({ name: "postgres", connection });
  }
  const my = Bun.env.BUNYAD_TEST_MYSQL_URL;
  if (my && /^mysql:\/\//i.test(my)) {
    const connection = connectMysql({ url: my } as never);
    if (await reachable(connection)) drivers.push({ name: "mysql", connection });
  }
  return drivers;
}
