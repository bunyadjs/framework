import { afterEach, expect, test } from "bun:test";
import { Application, createFetchHandler } from "@bunyad/core";
import { fireQueryExecuted } from "@bunyad/database";
import { json } from "@bunyad/http";
import { Log, setLogChannel } from "@bunyad/log";
import { Router } from "@bunyad/router";
import {
  Debugbar,
  DebugbarServiceProvider,
  isDebugbarEnabled,
  resolveOptions,
  type Snapshot,
} from "../src/index.ts";
import { isSecretKey, maskValue, redactText } from "../src/redact.ts";
import { bindingColumns, redactBindings, redactLiterals } from "../src/sql-redact.ts";
import { activeDebugbar } from "../src/state.ts";
import { Mcp } from "@bunyad/mcp";

const sensitive = (column: string) => isSecretKey(column, resolveOptions({}).redact);

async function boot(debugbar: Record<string, unknown> = { enabled: true }, app: Record<string, unknown> = {}) {
  const router = new Router();
  const application = new Application({ router, config: { app: { port: 0, ...app }, debugbar } });
  application.register(DebugbarServiceProvider);
  await application.boot();
  const fetch = createFetchHandler(application);
  const snapshotOf = async (res: Response) =>
    (await (await fetch(new Request(`http://localhost/_debugbar/${res.headers.get("X-Debugbar-Id")}`))).json()) as Snapshot;
  return { application, router, fetch, snapshotOf };
}

const connection = {} as never;
const fire = (sql: string, bindings: unknown[], timeMs = 1) => fireQueryExecuted({ sql, bindings, timeMs, connection });

afterEach(() => {
  delete process.env.DEBUGBAR;
});

// ---- SQL-aware masking -------------------------------------------------------------------

test("maps placeholders to the columns they are compared with", () => {
  const columns = (sql: string) => [...bindingColumns(sql)].map(([i, c]) => `${i}:${c}`);
  expect(columns('select * from users where "email" = ? and tenant_id = ?')).toEqual(["0:email", "1:tenant_id"]);
  expect(columns("update users set password = ?, name = ? where id = ?")).toEqual(["0:password", "1:name", "2:id"]);
  expect(columns("select * from t where phone in (?, ?, ?) and x = ?")).toEqual(["0:phone", "1:phone", "2:phone", "3:x"]);
  expect(columns("select * from t where created between ? and ?")).toEqual(["0:created", "1:created"]);
  expect(columns("select * from t where email = $1 or phone = $2")).toEqual(["0:email", "1:phone"]);
  expect(columns('select * from users u where u."email" like ?')).toEqual(["0:email"]);
  expect(columns("select * from t where x = ? limit ?")).toEqual(["0:x"]);
});

test("masks UPDATE, INSERT (multi-row), IN lists, LIKE and $n bindings by column", () => {
  expect(redactBindings("update users set password = ?, name = ? where id = ?", ["hash", "Bob", 3], sensitive)).toEqual(["********", "Bob", 3]);
  expect(
    redactBindings("insert into contacts (name, email, phone) values (?, ?, ?), (?, ?, ?)", ["A", "a@x", "111", "B", "b@x", "222"], sensitive),
  ).toEqual(["A", "********", "********", "B", "********", "********"]);
  expect(redactBindings("select * from t where phone in (?, ?, ?) and x = ?", ["1", "2", "3", "y"], sensitive)).toEqual(["********", "********", "********", "y"]);
  expect(redactBindings("select * from t where email = $1 or id = $2", ["e", 9], sensitive)).toEqual(["********", 9]);
  expect(redactBindings('select * from users u where u."email" like ?', ["%@x%"], sensitive)).toEqual(["********"]);
});

test("insert columns line up with nested expressions and ON CONFLICT clauses", () => {
  const sql = "insert into users (id, email, name) values (?, lower(?), coalesce(?, ?)) on conflict (id) do update set password = ?";
  expect(redactBindings(sql, [1, "E@X", "n", "d", "newhash"], sensitive)).toEqual([1, "********", "n", "d", "********"]);
});

test("masks inline string literals for sensitive columns only", () => {
  expect(redactLiterals("select * from users where email = 'a@b.c' and id = 5 and name = 'Bob'", sensitive)).toBe(
    "select * from users where email = '********' and id = 5 and name = 'Bob'",
  );
  expect(redactLiterals("select 'it''s fine' as note", sensitive)).toBe("select 'it''s fine' as note");
});

test("statements the parser cannot place are left alone, not broken", () => {
  expect(redactBindings("select ?, ?", ["a", "b"], sensitive)).toEqual(["a", "b"]);
  expect(redactBindings("", [], sensitive)).toEqual([]);
  expect(redactBindings("select * from t where x = ?", [], sensitive)).toEqual([]);
});

test("a very long IN list keeps its column", () => {
  const n = 600;
  const sql = `select * from users where email in (${Array(n).fill("?").join(", ")})`;
  const out = redactBindings(sql, Array.from({ length: n }, (_, i) => `u${i}@x`), sensitive);
  expect(out.every((v) => v === "********")).toBe(true);
});

test("regression: a window that cuts a column name in half must not pick the wrong column", () => {
  // Past ~130 items the 400-character lookbehind began inside "email" and matched "il".
  for (const n of [50, 131, 132, 133, 400, 1500]) {
    const sql = `select * from users where email in (${Array(n).fill("?").join(", ")})`;
    const out = redactBindings(sql, Array.from({ length: n }, (_, i) => `u${i}@x`), sensitive);
    expect(out.filter((v) => v !== "********")).toEqual([]);
  }
  const long = "a".repeat(600);
  expect(redactBindings(`select * from u where email in ('${long}', ?)`, ["x@y"], sensitive)).toEqual(["********"]);
  expect(redactLiterals(`select * from u where email in ('${long}', 'second@x.com')`, sensitive)).not.toContain("second@x.com");
});

test("masking a large statement stays fast", () => {
  const n = 5000;
  const sql = `select * from users where email in (${Array(n).fill("?").join(", ")}) and id = ?`;
  const bindings = Array.from({ length: n + 1 }, (_, i) => `u${i}`);
  const start = performance.now();
  const out = redactBindings(sql, bindings, sensitive);
  expect(performance.now() - start).toBeLessThan(200);
  expect(out[n]).toBe(`u${n}`); // the id binding after the list is untouched
  expect(out[0]).toBe("********");
});

// ---- value and text masking --------------------------------------------------------------

test("masks credential-shaped values in any field, but not ids", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123def456";
  expect(maskValue(jwt)).toBe("********");
  expect(maskValue("$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345")).toBe("********");
  expect(maskValue("Bearer abcdef0123456789")).toBe("********");
  expect(maskValue("a".repeat(48))).toBe("********");
  expect(maskValue("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301"); // uuid
  expect(maskValue("Blue Widget")).toBe("Blue Widget");
});

test("redactText masks secrets in free text", () => {
  expect(redactText("login failed password=hunter2 user=bob")).toBe("login failed password=******** user=bob");
  expect(redactText('sent {"token":"abc123"}')).toContain("********");
  expect(redactText("Authorization: Bearer abcdef012345 ok")).not.toContain("abcdef012345");
  expect(redactText("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig end")).toBe("jwt ******** end");
  expect(redactText("nothing secret here")).toBe("nothing secret here");
});

// ---- end to end through a request -------------------------------------------------------

test("a request's stored snapshot contains no raw secrets or personal data", async () => {
  const { router, fetch, snapshotOf } = await boot();
  setLogChannel({ log() {} });
  router.get("/leak", async () => {
    fire("update users set password = ?, name = ? where id = ?", ["$2b$10$SECRETHASHVALUE", "Bob", 3]);
    fire('select * from contacts where "email" = ? and phone = ?', ["bob@example.com", "+8801700000000"]);
    fire("select * from users where email = 'inline@example.com'", []);
    Log.error("charge failed token=aaaaaaaa1111 for bob");
    Debugbar.message("debug password=letmein");
    return json({});
  });
  const snap = await snapshotOf(await fetch(new Request("http://localhost/leak")));
  const blob = JSON.stringify(snap);

  for (const secret of ["SECRETHASHVALUE", "bob@example.com", "+8801700000000", "inline@example.com", "aaaaaaaa1111", "letmein"]) {
    expect(blob).not.toContain(secret);
  }
  expect(blob).not.toContain("fingerprint");
  expect(snap.queries.items[1]!.bindings).toEqual(["********", "********"]);
  expect(snap.queries.items[0]!.bindings).toEqual(["********", "Bob", 3]); // non-sensitive values stay readable
  expect(snap.queries.items[2]!.sql).toContain("'********'");
});

test("masked bindings do not hide N+1 patterns or duplicates", async () => {
  const { router, fetch, snapshotOf } = await boot();
  router.get("/n1", async () => {
    for (let i = 0; i < 6; i++) fire("select * from contacts where email = ?", [`user${i}@x.com`]);
    fire("select * from contacts where phone = ?", ["111"]);
    fire("select * from contacts where phone = ?", ["111"]);
    return json({});
  });
  const snap = await snapshotOf(await fetch(new Request("http://localhost/n1")));

  expect(snap.queries.items.slice(0, 6).every((q) => q.bindings[0] === "********")).toBe(true);
  expect(snap.queries.nPlusOne).toBe(6); // six different emails, even though all display as masked
  expect(snap.queries.duplicates).toBe(2); // the same phone twice is still a duplicate
});

test("captureBindings: false hides every value but keeps SQL, timing and N+1 detection", async () => {
  const { router, fetch, snapshotOf } = await boot({ enabled: true, captureBindings: false });
  router.get("/hide", async () => {
    for (let i = 0; i < 6; i++) fire("select * from products where sku = ?", [`SKU-${i}`]);
    return json({});
  });
  const snap = await snapshotOf(await fetch(new Request("http://localhost/hide")));
  expect(snap.queries.items[0]!.bindings).toEqual(["[hidden]"]);
  expect(JSON.stringify(snap)).not.toContain("SKU-3");
  expect(snap.queries.nPlusOne).toBe(6);
});

test("redactPii: false shows personal data but still masks secrets", async () => {
  const { router, fetch, snapshotOf } = await boot({ enabled: true, redactPii: false });
  router.get("/pii", async () => {
    fire("select * from contacts where email = ? and password = ?", ["bob@example.com", "hash"]);
    return json({});
  });
  const snap = await snapshotOf(await fetch(new Request("http://localhost/pii")));
  expect(snap.queries.items[0]!.bindings).toEqual(["bob@example.com", "********"]);
});

test("custom redact patterns apply to bindings too", async () => {
  const { router, fetch, snapshotOf } = await boot({ enabled: true, redact: [/loyalty/i] });
  router.get("/custom", async () => {
    fire("select * from cards where loyalty_no = ?", ["L-123"]);
    return json({});
  });
  expect((await snapshotOf(await fetch(new Request("http://localhost/custom")))).queries.items[0]!.bindings).toEqual(["********"]);
});

test("secret query values and secret route parameters are masked in the url and path", async () => {
  const { router, fetch, snapshotOf } = await boot();
  router.get("/reset/{token}", () => json({}));
  const snap = await snapshotOf(await fetch(new Request("http://localhost/reset/supersecretvalue?token=abc&page=2")));
  const blob = JSON.stringify(snap);
  expect(blob).not.toContain("supersecretvalue");
  expect(blob).not.toContain("token=abc");
  expect(snap.request.path).toBe("/reset/********");
  expect(snap.request.url).toContain("page=2");
  expect(snap.request.route.params.token).toBe("********");
});

test("exception messages and stacks are masked", async () => {
  const { router, fetch, snapshotOf } = await boot();
  router.get("/boom", () => {
    throw new Error("upstream said api_key=sk_live_ABCDEF rejected");
  });
  const snap = await snapshotOf(await fetch(new Request("http://localhost/boom", { headers: { Accept: "application/json" } })));
  expect(JSON.stringify(snap.exceptions)).not.toContain("sk_live_ABCDEF");
  expect(snap.exceptions[0]!.message).toContain("api_key=********");
});

// ---- production safety -------------------------------------------------------------------

const fakeApp = (over: Record<string, unknown> = {}) =>
  ({
    config: { get: (key: string) => (over.config as Record<string, unknown> | undefined)?.[key] },
    hasDebugModeEnabled: () => over.debug ?? true,
    isProduction: () => over.production ?? false,
    runningUnitTests: () => over.tests ?? false,
  }) as never;

test("enabled-ness: debug mode on, never production or tests, unless explicitly forced", () => {
  const enabled = (app: never, enabledOption?: boolean) => isDebugbarEnabled(app, { enabled: enabledOption });
  expect(enabled(fakeApp())).toBe(true);
  expect(enabled(fakeApp({ production: true }))).toBe(false);
  expect(enabled(fakeApp({ debug: false }))).toBe(false);
  expect(enabled(fakeApp({ tests: true }))).toBe(false);
  expect(enabled(fakeApp({ production: true }), false)).toBe(false); // option wins
  expect(enabled(fakeApp(), false)).toBe(false);
  expect(enabled(fakeApp({ production: true }), true)).toBe(true); // explicit opt-in is honoured
});

test("DEBUGBAR env beats debug mode, and an explicit option beats the env", () => {
  const app = fakeApp();
  process.env.DEBUGBAR = "false";
  expect(isDebugbarEnabled(app, { enabled: undefined })).toBe(false);
  process.env.DEBUGBAR = "0";
  expect(isDebugbarEnabled(app, { enabled: undefined })).toBe(false);
  process.env.DEBUGBAR = "true";
  expect(isDebugbarEnabled(fakeApp({ production: true }), { enabled: undefined })).toBe(true);
  expect(isDebugbarEnabled(fakeApp(), { enabled: false })).toBe(false);
});

test("a production app has no middleware, no header, no endpoints and no MCP tools", async () => {
  Mcp.forget();
  const { router, fetch, application } = await boot({}, { env: "production", debug: true });
  router.get("/page", () => new Response("<html><body>hi</body></html>", { headers: { "Content-Type": "text/html" } }));

  const res = await fetch(new Request("http://localhost/page"));
  expect(res.headers.get("X-Debugbar-Id")).toBeNull();
  expect(await res.text()).not.toContain("bunyad-debugbar");
  for (const path of ["/_debugbar", "/_debugbar/latest", "/_debugbar/0000000000000000"]) {
    expect((await fetch(new Request(`http://localhost${path}`))).status).toBe(404);
  }
  expect(application.getMiddleware().some((layer) => layer?.constructor?.name === "DebugbarMiddleware")).toBe(false);
  expect(Mcp.tools().filter((tool) => tool.name.startsWith("debugbar_"))).toEqual([]);
});

test("an app with no environment configured counts as production", async () => {
  const router = new Router();
  const application = new Application({ router, config: { app: { port: 0 } } });
  application.register(DebugbarServiceProvider);
  const previous = process.env.APP_ENV;
  delete process.env.APP_ENV;
  try {
    await application.boot();
    const res = await createFetchHandler(application)(new Request("http://localhost/_debugbar"));
    expect(res.status).toBe(404);
  } finally {
    if (previous !== undefined) process.env.APP_ENV = previous;
  }
});

test("activeDebugbar reports whether the bar is running", async () => {
  await boot({ enabled: true });
  expect(activeDebugbar()).toBeDefined();
});
