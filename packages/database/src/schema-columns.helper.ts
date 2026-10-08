import { connectMysql, connectPostgres, connectSqlite, type Connection } from "./index.ts";

export async function testDriversForDatabase(): Promise<Array<{ name: string; connection: Connection }>> {
  const out: Array<{ name: string; connection: Connection }> = [{ name: "sqlite", connection: connectSqlite() }];
  const pg = Bun.env.BUNYAD_TEST_POSTGRES_URL;
  if (pg && /^postgres/i.test(pg)) {
    const connection = connectPostgres({ url: pg, max: 2 });
    try { await connection.exec("SELECT 1"); out.push({ name: "postgres", connection }); } catch { /* unavailable */ }
  }
  const my = Bun.env.BUNYAD_TEST_MYSQL_URL;
  if (my && /^mysql/i.test(my)) {
    const connection = connectMysql({ url: my, tls: { rejectUnauthorized: false } });
    try { await connection.exec("SELECT 1"); out.push({ name: "mysql", connection }); } catch { /* unavailable */ }
  }
  return out;
}
