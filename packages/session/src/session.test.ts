import { expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Request, json, runPipeline } from "@bunyad/http";
import {
  FileSessionStore,
  MemorySessionStore,
  Session,
  SessionManager,
  getSessionStore,
  setSessionStore,
  startSession,
} from "../src/index.ts";

test("session put get flash ages out", () => {
  const session = new Session();
  session.put("user_id", 1);
  session.flash("status", "Saved");
  expect(session.get("status")).toBe("Saved");
  session.ageFlash();
  expect(session.get("status")).toBe("Saved");
  expect(session.get("_flash")).toEqual(["status"]);
  session.ageFlash();
  expect(session.has("status")).toBe(false);
});

test("session pull gets and forgets", () => {
  const session = new Session({ name: "Ada" });
  expect(session.pull("name")).toBe("Ada");
  expect(session.has("name")).toBe(false);
  expect(session.pull("missing", "fallback")).toBe("fallback");
});

test("session push flush exists missing now keep regenerate", () => {
  const session = new Session({}, "a".repeat(40));
  session.push("items", "a");
  session.push("items", "b");
  expect(session.get("items")).toEqual(["a", "b"]);

  session.put("nullable", null);
  expect(session.exists("nullable")).toBe(true);
  expect(session.has("nullable")).toBe(false);
  expect(session.missing("gone")).toBe(true);

  session.now("temp", 1);
  expect(session.get("temp")).toBe(1);
  session.ageFlash();
  expect(session.missing("temp")).toBe(true);

  session.flash("notice", "hi");
  session.ageFlash();
  expect(session.get("notice")).toBe("hi");
  session.keep("notice");
  session.ageFlash();
  expect(session.get("notice")).toBe("hi");

  session.flush();
  expect(session.all()).toEqual({});

  expect(session.regenerate()).toBe(true);
  const regen = session.consumeRegeneration();
  expect(regen?.oldId).toBe("a".repeat(40));
  expect(regen?.newId).not.toBe("a".repeat(40));
  expect(regen?.destroyOld).toBe(false);
});

test("session increment decrement token previousUrl migrate", () => {
  const session = new Session();
  session.setId(session.generateSessionId());
  session.start();
  expect(session.isStarted()).toBe(true);
  expect(session.token().length).toBe(40);

  expect(session.increment("count")).toBe(1);
  expect(session.increment("count", 2)).toBe(3);
  expect(session.decrement("count")).toBe(2);

  session.setPreviousUrl("/home");
  expect(session.previousUrl()).toBe("/home");
  expect(session.hasPreviousUri()).toBe(true);
  session.setPreviousRoute("home");
  expect(session.previousRoute()).toBe("home");

  session.flashInput({ email: "a@b.c" });
  expect(session.getOldInput("email")).toBe("a@b.c");
  expect(session.hasOldInput("email")).toBe(true);

  expect(session.remember("x", () => 42)).toBe(42);
  expect(session.remember("x", () => 99)).toBe(42);

  expect(session.only(["x"])).toEqual({ x: 42 });
  expect(session.except(["x"]).x).toBeUndefined();
  expect(session.remove("x")).toBe(42);
  expect(session.missing("x")).toBe(true);

  const before = session.getId();
  expect(session.migrate(true)).toBe(true);
  const mig = session.consumeRegeneration();
  expect(mig?.oldId).toBe(before);
  expect(mig?.destroyOld).toBe(true);
});

test("startSession skips persist for anonymous JSON with no cookie", async () => {
  const store = new MemorySessionStore();
  const writes: string[] = [];
  const orig = store.write.bind(store);
  store.write = async (id, data) => {
    writes.push(id);
    return orig(id, data);
  };
  const mw = startSession({ store });

  const request = new Request(new globalThis.Request("http://localhost/api"));
  const res = await runPipeline(request, [mw], async () =>
    json({ ok: true }),
  );
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect(writes).toEqual([]);
});

test("startSession persists new session for HTML responses", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store });

  const request = new Request(new globalThis.Request("http://localhost/login"));
  const res = await runPipeline(request, [mw], async () => {
    return new Response("<html></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
  expect(res.headers.get("Set-Cookie")).toContain("bunyad_session=");
  const id = decodeURIComponent(
    res.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!,
  );
  expect(await store.read(id)).toBeTruthy();
});

test("startSession middleware persists cookie", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store });

  const first = new Request(new globalThis.Request("http://localhost/"));
  const res1 = await runPipeline(first, [mw], async () => {
    first.session!.put("visits", 1);
    first.session!.flash("hello", "world");
    return json({ ok: true });
  });
  const setCookie = res1.headers.get("Set-Cookie")!;
  expect(setCookie).toContain("bunyad_session=");
  const id = decodeURIComponent(setCookie.split(";")[0]!.split("=")[1]!);

  const second = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { cookie: `bunyad_session=${id}` },
    }),
  );
  await runPipeline(second, [mw], async () => {
    expect(second.session!.get("visits")).toBe(1);
    expect(second.session!.get("hello")).toBe("world");
    return json({ ok: true });
  });
});

test("startSession regenerate rotates cookie id", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store });

  const first = new Request(new globalThis.Request("http://localhost/"));
  const res1 = await runPipeline(first, [mw], async () => {
    first.session!.put("user", 1);
    return json({ ok: true });
  });
  const oldId = decodeURIComponent(
    res1.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!,
  );

  const second = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { cookie: `bunyad_session=${oldId}` },
    }),
  );
  const res2 = await runPipeline(second, [mw], async () => {
    second.session!.regenerate(true);
    second.session!.put("user", 1);
    return json({ ok: true });
  });
  const setCookie = res2.headers.get("Set-Cookie");
  expect(setCookie).toBeTruthy();
  const newId = decodeURIComponent(setCookie!.split(";")[0]!.split("=")[1]!);
  expect(newId).not.toBe(oldId);
  expect(await store.read(oldId)).toBeUndefined();
  const saved = await store.read(newId);
  expect(saved?.user).toBe(1);
  expect(saved?._flash).toEqual([]);
  expect(typeof saved?._token).toBe("string");
});

test("FileSessionStore read write destroy", async () => {
  const dir = join(import.meta.dir, ".tmp-sessions");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const store = new FileSessionStore({ path: dir });
  await store.write("abc", { user_id: 7 });
  expect(await store.read("abc")).toEqual({ user_id: 7 });
  await store.destroy("abc");
  expect(await store.read("abc")).toBeUndefined();

  await rm(dir, { recursive: true, force: true });
});

test("FileSessionStore respects lifetime", async () => {
  const dir = join(import.meta.dir, ".tmp-sessions-ttl");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const store = new FileSessionStore({ path: dir, lifetime: 0 });
  await store.write("old", { x: 1 });
  // lifetime 0 → any positive age expires; bump mtime into the past via rewrite after delay
  await Bun.sleep(5);
  // Force expire by treating 0 minutes as immediate: mtime must be older than now.
  // With lifetime 0, lifetimeMs is 0, so Date.now() - mtimeMs > 0 is true after any delay.
  expect(await store.read("old")).toBeUndefined();

  await rm(dir, { recursive: true, force: true });
});

test("EncryptedSessionStore round-trips payload", async () => {
  const { Crypt } = await import("@bunyad/common");
  const { EncryptedSessionStore, MemorySessionStore } = await import(
    "../src/index.ts"
  );
  Crypt.setKey("base64:" + Buffer.alloc(32, 7).toString("base64"));
  try {
    const inner = new MemorySessionStore();
    const store = new EncryptedSessionStore(inner);
    await store.write("s1", { user_id: 9, _token: "abc" });
    const raw = await inner.read("s1");
    expect(raw?.__bunyad_enc).toBeTypeOf("string");
    expect(await store.read("s1")).toEqual({ user_id: 9, _token: "abc" });
  } finally {
    Crypt.clearKey();
  }
});

test("startSession sets Max-Age from lifetime", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store, lifetime: 120, secure: false });
  const req = new Request(new globalThis.Request("http://localhost/"));
  const res = await mw.handle(req, (async () => {
    req.session!.put("x", 1);
    return new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    });
  }) as never);
  const cookie = res.headers.get("Set-Cookie") ?? "";
  expect(cookie).toContain("Max-Age=7200");
});

test("DatabaseSessionStore read write destroy and expiry", async () => {
  const { connectSqlite } = await import("@bunyad/database");
  const { DatabaseSessionStore } = await import("../src/index.ts");

  const db = await connectSqlite(":memory:");
  await db.run(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NULL,
      ip_address TEXT NULL,
      user_agent TEXT NULL,
      payload TEXT NOT NULL,
      last_activity INTEGER NOT NULL
    )
  `);

  const store = new DatabaseSessionStore({
    connection: db,
    lifetime: 120,
  });
  await store.write("sid-1", { user_id: 42 });
  expect(await store.read("sid-1")).toEqual({ user_id: 42 });
  await store.destroy("sid-1");
  expect(await store.read("sid-1")).toBeUndefined();

  const expired = new DatabaseSessionStore({
    connection: db,
    lifetime: 0, // expire immediately (0 minutes → last_activity must be >= now)
  });
  // lifetime 0 means minActivity = now, so last_activity < now fails unless same second.
  // Force old last_activity:
  await db.run(
    `INSERT INTO sessions (id, payload, last_activity) VALUES (?, ?, ?)`,
    ["old", JSON.stringify({ x: 1 }), Math.floor(Date.now() / 1000) - 10],
  );
  expect(await expired.read("old")).toBeUndefined();
  expect(
    await db.get<{ id: string }>(`SELECT id FROM sessions WHERE id = ?`, [
      "old",
    ]),
  ).toBeNull();

  await db.close();
});

test("RedisSessionStore with mock client", async () => {
  const map = new Map<string, string>();
  const client = {
    async get(key: string) {
      return map.get(key) ?? null;
    },
    async set(key: string, value: string) {
      map.set(key, value);
      return "OK";
    },
    async expire(_key: string, _seconds: number) {
      return 1;
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) if (map.delete(k)) n += 1;
      return n;
    },
    close() {},
  };

  const { RedisSessionStore } = await import("../src/index.ts");
  const store = new RedisSessionStore({
    client: client as never,
    prefix: "sess:",
    lifetime: 60,
  });
  await store.write("abc", { visits: 3 });
  expect(await store.read("abc")).toEqual({ visits: 3 });
  await store.destroy("abc");
  expect(await store.read("abc")).toBeUndefined();
});

test("startSession sets Secure cookie on HTTPS by default", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store });

  const request = new Request(
    new globalThis.Request("https://example.com/login"),
  );
  const res = await runPipeline(request, [mw], async () => {
    return new Response("<html></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  });
  const setCookie = res.headers.get("Set-Cookie")!;
  expect(setCookie).toContain("bunyad_session=");
  expect(setCookie).toContain("Secure");
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toMatch(/SameSite=Lax/i);
});

test("startSession cookie option matrix", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({
    store,
    secure: true,
    sameSite: "Strict",
    domain: "example.com",
  });

  const request = new Request(new globalThis.Request("http://localhost/"));
  const res = await runPipeline(request, [mw], async () => {
    request.session!.put("x", 1);
    return json({ ok: true });
  });
  const setCookie = res.headers.get("Set-Cookie")!;
  expect(setCookie).toContain("Secure");
  expect(setCookie).toMatch(/SameSite=Strict/i);
  expect(setCookie).toContain("Domain=example.com");
});

test("startSession secure:false omits Secure even on HTTPS", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store, secure: false });
  const request = new Request(
    new globalThis.Request("https://example.com/"),
  );
  const res = await runPipeline(request, [mw], async () => {
    return new Response("<html></html>", {
      headers: { "Content-Type": "text/html" },
    });
  });
  expect(res.headers.get("Set-Cookie")!).not.toContain("Secure");
});

test("session forget removes string or array keys", () => {
  const session = new Session({ a: 1, b: 2, c: 3 });
  session.forget("a");
  expect(session.exists("a")).toBe(false);
  session.forget(["b", "c"]);
  expect(session.all()).toEqual({});
});

test("session reflash keeps previous flash for another request", () => {
  const session = new Session();
  session.flash("status", "Saved");
  session.ageFlash();
  expect(session.get("status")).toBe("Saved");
  expect(session.get("_flash")).toEqual(["status"]);
  session.reflash();
  session.ageFlash();
  expect(session.get("status")).toBe("Saved");
  expect(session.get("_flash")).toEqual(["status"]);
});

test("session invalidate flushes data and schedules destroy migrate", () => {
  const session = new Session({ user: 1 }, "b".repeat(40));
  expect(session.invalidate()).toBe(true);
  expect(session.get("user")).toBeUndefined();
  const regen = session.consumeRegeneration();
  expect(regen?.oldId).toBe("b".repeat(40));
  expect(regen?.destroyOld).toBe(true);
  expect(regen?.newId).not.toBe("b".repeat(40));
  expect(session.token().length).toBe(40);
});

test("startSession invalidate destroys old record and rotates cookie", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store, secure: false });

  const first = new Request(new globalThis.Request("http://localhost/"));
  const res1 = await runPipeline(first, [mw], async () => {
    first.session!.put("secret", "x");
    return json({ ok: true });
  });
  const oldId = decodeURIComponent(
    res1.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!,
  );
  expect(await store.read(oldId)).toMatchObject({ secret: "x" });

  const second = new Request(
    new globalThis.Request("http://localhost/", {
      headers: { cookie: `bunyad_session=${oldId}` },
    }),
  );
  const res2 = await runPipeline(second, [mw], async () => {
    second.session!.invalidate();
    return json({ ok: true });
  });
  const newId = decodeURIComponent(
    res2.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!,
  );
  expect(newId).not.toBe(oldId);
  expect(await store.read(oldId)).toBeUndefined();
  const saved = await store.read(newId);
  expect(saved?.secret).toBeUndefined();
  expect(typeof saved?._token).toBe("string");
});

test("SessionManager memory driver extend and start", () => {
  const manager = new SessionManager({ default: "memory" });
  const mem = manager.driver();
  expect(mem).toBeInstanceOf(MemorySessionStore);
  expect(manager.getDefaultDriver()).toBe("memory");

  const custom = new MemorySessionStore();
  manager.extend("custom", () => custom);
  expect(manager.driver("custom")).toBe(custom);

  const bag = manager.start({ hello: "world" });
  expect(bag.isStarted()).toBe(true);
  expect(bag.get("hello")).toBe("world");
  expect(bag.getId().length).toBe(40);
});

test("startSession uses setSessionStore default store", async () => {
  const store = new MemorySessionStore();
  const prev = getSessionStore();
  setSessionStore(store);
  try {
    const mw = startSession({ secure: false });
    const request = new Request(new globalThis.Request("http://localhost/"));
    const res = await runPipeline(request, [mw], async () => {
      request.session!.put("via", "default");
      return json({ ok: true });
    });
    const id = decodeURIComponent(
      res.headers.get("Set-Cookie")!.split(";")[0]!.split("=")[1]!,
    );
    expect(await store.read(id)).toMatchObject({ via: "default" });
  } finally {
    setSessionStore(prev);
  }
});

test("startSession sets Secure cookie when APP_ENV is production", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({ store });
  const prevApp = process.env.APP_ENV;
  const prevNode = process.env.NODE_ENV;
  process.env.APP_ENV = "production";
  delete process.env.NODE_ENV;
  try {
    const request = new Request(new globalThis.Request("http://localhost/login"));
    const res = await runPipeline(request, [mw], async () => {
      return new Response("<html></html>", {
        headers: { "Content-Type": "text/html" },
      });
    });
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
  } finally {
    if (prevApp === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevApp;
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
  }
});

test("startSession SameSite=None forces Secure even if secure:false", async () => {
  const store = new MemorySessionStore();
  const mw = startSession({
    store,
    sameSite: "None",
    secure: false,
  });
  const request = new Request(new globalThis.Request("http://localhost/"));
  const res = await runPipeline(request, [mw], async () => {
    request.session!.put("x", 1);
    return json({ ok: true });
  });
  const setCookie = res.headers.get("Set-Cookie")!;
  expect(setCookie).toMatch(/SameSite=None/i);
  expect(setCookie).toContain("Secure");
});

test("Session.block serializes concurrent requests for the same session", async () => {
  const { CacheRepository, MemoryCacheStore, setCache } =
    await import("@bunyad/cache");
  setCache(new CacheRepository(new MemoryCacheStore()));

  const store = new MemorySessionStore();
  const sessionMw = startSession({ store });
  const blockMw = Session.block(5, 5);

  const id = new Session().generateSessionId();
  await store.write(id, { n: 0 });

  let active = 0;
  let maxActive = 0;

  const run = async () => {
    const request = new Request(
      new globalThis.Request("http://localhost/", {
        headers: { cookie: `bunyad_session=${id}` },
      }),
    );
    return runPipeline(request, [sessionMw, blockMw], async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Bun.sleep(40);
      active -= 1;
      return json({ ok: true });
    });
  };

  await Promise.all([run(), run(), run()]);
  expect(maxActive).toBe(1);
});

test("re-flashing a key keeps it for the next request", () => {
  const session = new Session();
  session.flash("errors", { email: ["first"] });
  session.ageFlashData();

  session.flash("errors", { email: ["second"] });
  session.ageFlashData();

  expect(session.get("errors")).toEqual({ email: ["second"] });
  session.ageFlashData();
  expect(session.get("errors")).toBeUndefined();
});
