import { expect, test } from "bun:test";
import { DB, clearQueryListeners, connectSqlite, listen, setDefaultConnection, wantsCallSites } from "./index.ts";

async function setup() {
  clearQueryListeners();
  const connection = connectSqlite();
  setDefaultConnection(connection);
  await connection.exec("CREATE TABLE call_site_demo (id INTEGER PRIMARY KEY, name TEXT)");
  return connection;
}

// The function name below is what the assertions look for in the captured stack.
async function issueTheQuery() {
  return DB.select("SELECT * FROM call_site_demo");
}

test("a listener that asks for call sites gets the stack from when the query was issued", async () => {
  const connection = await setup();
  const sites: Array<string | undefined> = [];
  const stop = listen((event) => sites.push(event.callSite), { callSites: true });

  await issueTheQuery();
  stop();

  expect(sites).toHaveLength(1);
  expect(sites[0]).toContain("issueTheQuery");
  expect(sites[0]).toContain("query-listen.test.ts");
  clearQueryListeners();
  await connection.close();
});

test("the call site survives an await before the query is issued", async () => {
  const connection = await setup();
  const sites: string[] = [];
  const stop = listen((event) => sites.push(event.callSite ?? ""), { callSites: true });

  async function loadAfterAwait() {
    await Promise.resolve(); // an async driver or an eager load puts awaits like this before the query
    // `await` it (not `return DB.select(...)`): JavaScriptCore drops the caller's frame for a tail call.
    const rows = await DB.select("SELECT * FROM call_site_demo");
    return rows;
  }
  await loadAfterAwait();
  stop();

  expect(sites[0]).toContain("loadAfterAwait");
  clearQueryListeners();
  await connection.close();
});

test("without a call-site listener nothing is captured, and plain listeners are unaffected", async () => {
  const connection = await setup();
  const plain: Array<string | undefined> = [];
  const stop = listen((event) => plain.push(event.callSite));

  expect(wantsCallSites()).toBe(false);
  await issueTheQuery();
  stop();

  expect(plain).toEqual([undefined]);
  clearQueryListeners();
  await connection.close();
});

test("wantsCallSites follows the listeners that asked and stops after unsubscribe", async () => {
  clearQueryListeners();
  const stopPlain = listen(() => {});
  expect(wantsCallSites()).toBe(false);
  const stopSites = listen(() => {}, { callSites: true });
  expect(wantsCallSites()).toBe(true);
  stopSites();
  expect(wantsCallSites()).toBe(false);
  stopPlain();
  clearQueryListeners();
});

test("streamed queries carry a call site too", async () => {
  const connection = await setup();
  await DB.table("call_site_demo").insert({ name: "a" });
  const sites: string[] = [];
  const stop = listen((event) => sites.push(event.callSite ?? ""), { callSites: true });

  async function streamIt() {
    for await (const _row of DB.table("call_site_demo").cursor()) {
      // drain
    }
  }
  await streamIt();
  stop();

  expect(sites.some((site) => site.includes("streamIt"))).toBe(true);
  clearQueryListeners();
  await connection.close();
});

test("a tail call after an await still reports a call site, with or without the caller's frame", async () => {
  const connection = await setup();
  const sites: string[] = [];
  const stop = listen((event) => sites.push(event.callSite ?? ""), { callSites: true });

  async function tailCallAfterAwait() {
    await Promise.resolve();
    return DB.select("SELECT * FROM call_site_demo");
  }
  await tailCallAfterAwait();
  stop();

  // Documented in the debugbar README: origin is best-effort. Some JavaScriptCore versions drop the
  // caller of a tail call and newer ones keep it, so only the capture itself is asserted.
  expect(sites).toHaveLength(1);
  expect(sites[0]).toBeTruthy();
  clearQueryListeners();
  await connection.close();
});
