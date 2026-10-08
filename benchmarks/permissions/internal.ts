/**
 * Permissions micro-benchmarks: how many statements and how long a check takes
 * on a large grants table.
 *
 *   bun benchmarks/permissions/internal.ts
 *   SUBJECTS=200000 TENANTS=2000 bun benchmarks/permissions/internal.ts
 *
 * SQLite in memory always; BUNYAD_TEST_POSTGRES_URL / BUNYAD_TEST_MYSQL_URL add those servers
 * (use a throwaway database: the four permission tables are dropped and recreated).
 */
import { connectMysql, connectPostgres, connectSqlite, schemaFor, type Connection } from "../../packages/database/src/index.ts";
import { Permissions, createPermissionTables, dropPermissionTables, ScopeTree } from "../../packages/permissions/src/index.ts";

const SUBJECTS = Number(Bun.env.SUBJECTS ?? 100_000);
const TENANTS = Number(Bun.env.TENANTS ?? 1_000);
const PERMISSIONS = Number(Bun.env.PERMISSIONS ?? 200);
const SAMPLE = Number(Bun.env.SAMPLE ?? 5_000);
const WARM_CHECKS = Number(Bun.env.WARM_CHECKS ?? 1_000_000);

const drivers: Array<{ name: string; connection: Connection }> = [{ name: "sqlite", connection: connectSqlite() }];
const pg = Bun.env.BUNYAD_TEST_POSTGRES_URL;
if (pg) drivers.push({ name: "postgres", connection: connectPostgres({ url: pg, max: 2 }) });
const my = Bun.env.BUNYAD_TEST_MYSQL_URL;
if (my) drivers.push({ name: "mysql", connection: connectMysql({ url: my, tls: { rejectUnauthorized: false } }) });

const ms = (start: number) => (performance.now() - start).toFixed(1);

async function bulk(connection: Connection, sql: string, width: number, rows: unknown[][], chunk = 500) {
  const group = `(${Array.from({ length: width }, () => "?").join(",")})`;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await connection.run(`${sql} VALUES ${part.map(() => group).join(",")}`, part.flat());
  }
}

for (const { name, connection } of drivers) {
  console.log(`\n== ${name}: ${SUBJECTS} subjects, ${TENANTS} tenants, ${PERMISSIONS} permissions ==`);
  const schema = schemaFor(connection);
  await dropPermissionTables(schema);
  await createPermissionTables(schema);

  let reads = 0;
  const db = {
    run: (sql: string, params?: unknown[]) => connection.run(sql, params),
    get: (sql: string, params?: unknown[]) => (reads++, connection.get(sql, params)),
    all: (sql: string, params?: unknown[]) => (reads++, connection.all(sql, params)),
    transaction: <T>(fn: () => T | Promise<T>) => connection.transaction(fn),
  };
  const make = () =>
    new Permissions({ db, scopes: new ScopeTree(), consistency: "eventual", ttlMs: 3_600_000, strict: false });

  // --- seed ---
  let t = performance.now();
  const setup = make();
  const names = Array.from({ length: PERMISSIONS }, (_, i) => `res${i % 20}.action${Math.floor(i / 20)}`);
  await setup.sync(names);
  const roleNames = ["viewer", "editor", "manager", "admin", "owner"];
  for (const [i, role] of roleNames.entries()) {
    await setup.createRole(role);
    await setup.givePermissions({ name: role }, names.slice(0, 20 * (i + 1)));
  }
  console.log(`seed permissions + 5 template roles: ${ms(t)} ms`);

  t = performance.now();
  for (let tenant = 0; tenant < TENANTS; tenant++) await setup.copyRoles("*", `tenant:${tenant}`);
  console.log(`copyRoles into ${TENANTS} tenants: ${ms(t)} ms (${(Number(ms(t)) / TENANTS).toFixed(2)} ms per tenant)`);

  t = performance.now();
  const roleRows = await connection.all<{ id: number; scope: string; name: string }>("SELECT id, scope, name FROM roles");
  const byScope = new Map<string, number[]>();
  for (const row of roleRows) if (row.scope !== "*") (byScope.get(row.scope) ?? byScope.set(row.scope, []).get(row.scope)!).push(row.id);
  const now = Math.floor(Date.now() / 1000);
  const grants: unknown[][] = [];
  for (let s = 0; s < SUBJECTS; s++) {
    const scope = `tenant:${s % TENANTS}`;
    const ids = byScope.get(scope)!;
    grants.push(["user", String(s), scope, 1, ids[s % ids.length]!, null, now]);
    if (s % 5 === 0) grants.push(["user", String(s), scope, 2, 1 + (s % PERMISSIONS), null, now]);
  }
  await bulk(connection, "INSERT INTO grants (subject_type, subject_id, scope, kind, target_id, expires_at, created_at)", 7, grants);
  console.log(`seed ${grants.length} grants: ${ms(t)} ms`);

  // --- cold: first check of distinct subjects, snapshots warm after the first per tenant ---
  const sample = Array.from({ length: SAMPLE }, (_, i) => (i * 7919) % SUBJECTS);
  const cold = make();
  reads = 0;
  t = performance.now();
  for (const s of sample) await cold.can({ type: "user", id: s }, names[0]!, `tenant:${s % TENANTS}`);
  const coldMs = performance.now() - t;
  console.log(`cold first check, ${SAMPLE} subjects: ${(coldMs / SAMPLE).toFixed(3)} ms each, ${(reads / SAMPLE).toFixed(2)} statements each`);

  // --- truly cold: new process state, one subject ---
  const single: number[] = [];
  let singleReads = 0;
  for (const s of sample.slice(0, 200)) {
    const fresh = make();
    reads = 0;
    t = performance.now();
    await fresh.can({ type: "user", id: s }, names[0]!, `tenant:${s % TENANTS}`);
    single.push(performance.now() - t);
    singleReads += reads;
  }
  single.sort((a, b) => a - b);
  console.log(
    `fully cold (empty process), 200 subjects: p50 ${single[100]!.toFixed(3)} ms, p95 ${single[190]!.toFixed(3)} ms, ${(singleReads / 200).toFixed(2)} statements each (incl. registry load)`,
  );

  // --- warm ---
  reads = 0;
  const probe = { type: "user", id: sample[0]! };
  const scope = `tenant:${sample[0]! % TENANTS}`;
  await cold.can(probe, names[0]!, scope);
  t = performance.now();
  let allowed = 0;
  for (let i = 0; i < WARM_CHECKS; i++) if (await cold.can(probe, names[i % 20]!, scope)) allowed++;
  const warmMs = performance.now() - t;
  console.log(`warm check x${WARM_CHECKS}: ${((warmMs * 1_000_000) / WARM_CHECKS).toFixed(0)} ns each, ${reads} statements (allowed ${allowed})`);

  // --- writes ---
  t = performance.now();
  for (let i = 0; i < 200; i++) await cold.grantRole({ type: "user", id: sample[i]! }, "viewer", `tenant:${sample[i]! % TENANTS}`);
  console.log(`grantRole x200: ${(Number(ms(t)) / 200).toFixed(2)} ms each`);
  t = performance.now();
  await cold.givePermissions({ name: "viewer", scope: "tenant:0" }, [names[150]!]);
  console.log(`role edit in a tenant with ${Math.ceil(SUBJECTS / TENANTS)} members: ${ms(t)} ms (no per-member writes)`);

  await dropPermissionTables(schema);
  await connection.close();
}
