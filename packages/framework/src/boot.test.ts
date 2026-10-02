import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "@bunyad/core";
import { Dispatcher, getEventDispatcher } from "@bunyad/events";
import { Feature } from "@bunyad/features";
import { Storage, StorageManager, getStorage, setStorage } from "@bunyad/filesystem";
import {
  getCorsConfig,
  getRateLimiter,
  handleCors,
  Request,
  setCorsConfig,
} from "@bunyad/http";
import {
  FRAMEWORK_PROVIDERS,
  bootFrameworkProviders,
  loadFrameworkConfig,
  registerFrameworkProviders,
  type FrameworkProviderName,
} from "./providers/index.ts";
import { EventServiceProvider } from "./providers/EventServiceProvider.ts";
import { FeatureServiceProvider } from "./providers/FeatureServiceProvider.ts";
import { FilesystemServiceProvider } from "./providers/FilesystemServiceProvider.ts";
import { HttpServiceProvider } from "./providers/HttpServiceProvider.ts";
import { ResetPassword, VerifyEmail } from "./auth-notifications.ts";
import { defaultCompilerPlugins } from "./plugins.ts";
import { tokenGuardUsing } from "./token-guard-using.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bunyad-framework-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeApp(config: Record<string, unknown> = {}) {
  return new Application({ basePath: dir, config: { app: { port: 0 }, ...config } });
}

/** Record which providers get registered, without running their register(). */
function recordRegistrations(app: Application): string[] {
  const names: string[] = [];
  (app as unknown as { register: (p: { name: string }) => Application }).register = (provider) => {
    names.push(provider.name);
    return app;
  };
  return names;
}

describe("framework provider list", () => {
  test("every provider is registered once, in the documented boot order", () => {
    const app = makeApp();
    const names = recordRegistrations(app);
    registerFrameworkProviders(app);
    expect(names).toEqual(FRAMEWORK_PROVIDERS.map(([, Provider]) => Provider.name));
    expect(new Set(names).size).toBe(names.length);
  });

  test("database boots first, and dependants come after the providers they rely on", () => {
    const order = FRAMEWORK_PROVIDERS.map(([name]) => name as string);
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    expect(order[0]).toBe("database");
    before("events", "notifications"); // notifications dispatch through events
    before("cache", "http"); // http shares rate-limit counters through the cache binding
    before("session", "auth");
    before("head", "inertia"); // head shares its props with inertia
  });

  test("except removes only the named providers and keeps the rest in order", () => {
    const app = makeApp();
    const names = recordRegistrations(app);
    registerFrameworkProviders(app, { except: ["mail", "queue", "live"] });
    const all = FRAMEWORK_PROVIDERS.map(([, Provider]) => Provider.name);
    expect(names).toEqual(all.filter((n) => !["MailServiceProvider", "QueueServiceProvider", "LiveServiceProvider"].includes(n)));
  });

  test("excluding every provider registers nothing", () => {
    const app = makeApp();
    const names = recordRegistrations(app);
    registerFrameworkProviders(app, { except: FRAMEWORK_PROVIDERS.map(([name]) => name) as FrameworkProviderName[] });
    expect(names).toEqual([]);
  });

  test("an unknown name fails before anything is registered", () => {
    const app = makeApp();
    const names = recordRegistrations(app);
    expect(() =>
      registerFrameworkProviders(app, { except: ["mail", "mial" as never] }),
    ).toThrow("Unknown framework provider [mial].");
    expect(names).toEqual([]);
  });

  test("duplicates in except are harmless", () => {
    const app = makeApp();
    const names = recordRegistrations(app);
    registerFrameworkProviders(app, { except: ["mail", "mail"] });
    expect(names).toHaveLength(FRAMEWORK_PROVIDERS.length - 1);
  });
});

describe("loadFrameworkConfig", () => {
  async function config(name: string, source: string) {
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(join(dir, "config", `${name}.ts`), source);
  }

  test("loads object and factory configs; factories get databasePath() and the app", async () => {
    await config("queue", "export default { default: 'sync' };\n");
    await config(
      "database",
      "export default (databasePath: (p?: string) => string, app: { basePath(): string }) => ({ file: databasePath('x.sqlite'), base: app.basePath() });\n",
    );
    const app = makeApp();
    await loadFrameworkConfig(app);
    expect(app.config.get<unknown>("queue")).toEqual({ default: "sync" });
    expect(app.config.get<unknown>("database")).toEqual({
      file: join(dir, "database", "x.sqlite"),
      base: dir,
    });
  });

  test("a broken config file is skipped and does not block the others", async () => {
    await config("cache", "throw new Error('bad config');\n");
    await config("session", "export default { driver: 'array' };\n");
    const app = makeApp();
    await loadFrameworkConfig(app);
    expect(app.config.get("cache")).toBeUndefined();
    expect(app.config.get<unknown>("session")).toEqual({ driver: "array" });
  });

  test("files outside the framework's list are not loaded", async () => {
    await config("custom", "export default { secret: true };\n");
    const app = makeApp();
    await loadFrameworkConfig(app);
    expect(app.config.get("custom")).toBeUndefined();
  });

  test("a missing config directory is fine and leaves existing config alone", async () => {
    const app = makeApp({ mail: { default: "log" } });
    await loadFrameworkConfig(app);
    expect(app.config.get<unknown>("mail")).toEqual({ default: "log" });
  });

  test("bootFrameworkProviders loads config before registering providers", async () => {
    await config("mail", "export default { default: 'from-file' };\n");
    const app = makeApp();
    const seenAtRegister: unknown[] = [];
    (app as unknown as { register: () => Application }).register = () => {
      seenAtRegister.push(app.config.get<unknown>("mail"));
      return app;
    };
    await bootFrameworkProviders(app, { except: ["database"] });
    expect(seenAtRegister.length).toBe(FRAMEWORK_PROVIDERS.length - 1);
    expect(seenAtRegister.every((v) => (v as { default: string }).default === "from-file")).toBe(true);
  });
});

describe("FilesystemServiceProvider", () => {
  const previous = getStorage();
  const saved = {
    disk: process.env.FILESYSTEM_DISK,
    bucket: process.env.AWS_BUCKET,
  };

  beforeEach(() => {
    delete process.env.FILESYSTEM_DISK;
    delete process.env.AWS_BUCKET;
  });

  afterEach(() => {
    if (previous) setStorage(previous);
    if (saved.disk === undefined) delete process.env.FILESYSTEM_DISK;
    else process.env.FILESYSTEM_DISK = saved.disk;
    if (saved.bucket === undefined) delete process.env.AWS_BUCKET;
    else process.env.AWS_BUCKET = saved.bucket;
  });

  test("without config: local and public disks live under storage/", () => {
    makeApp().register(FilesystemServiceProvider);
    expect(Storage.getDefaultDriver()).toBe("local");
    expect(Storage.disk("local").path("a.txt")).toBe(join(dir, "storage", "app", "a.txt"));
    expect(Storage.disk("public").path("a.txt")).toBe(join(dir, "storage", "app", "public", "a.txt"));
    expect(Storage.disk("public").url("a.txt")).toBe("/storage/a.txt");
  });

  test("relative roots resolve under storage/, absolute roots are kept as-is", () => {
    const abs = join(dir, "elsewhere");
    makeApp({
      filesystems: { disks: { local: { root: "private" }, mounted: { root: abs, url: "https://cdn.test/f" } } },
    }).register(FilesystemServiceProvider);
    expect(Storage.disk("local").path()).toBe(join(dir, "storage", "private"));
    expect(Storage.disk("mounted").path()).toBe(abs);
    expect(Storage.disk("mounted").url("x.png")).toBe("https://cdn.test/f/x.png");
  });

  test("a local disk is always available, even when only other disks are configured", () => {
    makeApp({ filesystems: { disks: { archive: { root: "archive" } } } }).register(FilesystemServiceProvider);
    expect(Storage.disk("local").path()).toBe(join(dir, "storage", "app"));
    expect(Storage.disk("archive").path()).toBe(join(dir, "storage", "archive"));
  });

  test("an s3 disk without a bucket is skipped instead of failing boot", () => {
    makeApp({ filesystems: { disks: { s3: { driver: "s3" } } } }).register(FilesystemServiceProvider);
    expect(() => Storage.disk("s3")).toThrow("not configured");
    expect(Storage.disk("local")).toBeDefined();
  });

  test("the default disk comes from config first, then FILESYSTEM_DISK, then local", () => {
    process.env.FILESYSTEM_DISK = "public";
    makeApp().register(FilesystemServiceProvider);
    expect(Storage.getDefaultDriver()).toBe("public");
    makeApp({ filesystems: { default: "local" } }).register(FilesystemServiceProvider);
    expect(Storage.getDefaultDriver()).toBe("local");
  });

  test("the configured disks work end to end", async () => {
    makeApp().register(FilesystemServiceProvider);
    await Storage.put("notes/a.txt", "hi");
    expect(await Bun.file(join(dir, "storage", "app", "notes", "a.txt")).text()).toBe("hi");
    expect(getStorage()).toBeInstanceOf(StorageManager);
  });
});

describe("HttpServiceProvider", () => {
  afterEach(() => setCorsConfig(undefined));

  test("register installs a fresh rate limiter and the cors config from the app", () => {
    const before = getRateLimiter();
    makeApp({ cors: { paths: ["api/*"], allowed_origins: ["https://a.test"] } }).register(HttpServiceProvider);
    expect(getRateLimiter()).not.toBe(before);
    expect(getCorsConfig()).toMatchObject({ paths: ["api/*"], allowed_origins: ["https://a.test"] });
  });

  test("boot puts cors first in the global stack, exactly once", () => {
    const app = makeApp();
    const marker = { handle: (_r: unknown, next: () => Promise<Response>) => next() };
    app.middleware([marker as never]);
    new HttpServiceProvider(app).boot();
    const stack = app.getMiddleware();
    expect(stack).toHaveLength(2);
    expect((stack[0] as { alias?: string }).alias).toBe("cors");
    expect(stack[1]).toBe(marker as never);

    new HttpServiceProvider(app).boot();
    expect(app.getMiddleware()).toHaveLength(2);
  });

  test("an app that already installed its own cors middleware is left untouched", () => {
    const app = makeApp();
    const own = handleCors({ paths: ["x"] });
    app.middleware([own]);
    new HttpServiceProvider(app).boot();
    expect(app.getMiddleware()).toEqual([own]);
  });

  test("boot shares rate limit state through the cache binding when present", () => {
    const app = makeApp();
    const used: unknown[] = [];
    const limiter = getRateLimiter();
    const original = limiter.use.bind(limiter);
    limiter.use = ((cache: unknown) => {
      used.push(cache);
      return original(cache as never);
    }) as never;
    const cache = { get: async () => null, put: async () => true, increment: async () => 1 };
    app.instance("cache", cache);
    try {
      new HttpServiceProvider(app).boot();
    } finally {
      limiter.use = original as never;
    }
    expect(used).toEqual([cache]);
  });

  test("boot without a cache binding does not throw", () => {
    expect(() => new HttpServiceProvider(makeApp()).boot()).not.toThrow();
  });
});

describe("EventServiceProvider and FeatureServiceProvider", () => {
  test("register installs a new event dispatcher bound to the application container", () => {
    const before = getEventDispatcher();
    makeApp().register(EventServiceProvider);
    const after = getEventDispatcher();
    expect(after).toBeInstanceOf(Dispatcher);
    expect(after).not.toBe(before);
  });

  describe("features store", () => {
    const originalUseStore = Feature.useStore.bind(Feature);
    let stores: unknown[];
    const savedEnv = process.env.FEATURES_STORE;

    beforeEach(() => {
      stores = [];
      delete process.env.FEATURES_STORE;
      (Feature as { useStore: unknown }).useStore = (store: unknown) => {
        stores.push(store);
        return Feature;
      };
    });

    afterEach(() => {
      (Feature as { useStore: unknown }).useStore = originalUseStore;
      if (savedEnv === undefined) delete process.env.FEATURES_STORE;
      else process.env.FEATURES_STORE = savedEnv;
    });

    test("stays on the in-memory store unless 'database' is requested", () => {
      makeApp().register(FeatureServiceProvider);
      makeApp({ features: { default: "array" } }).register(FeatureServiceProvider);
      expect(stores).toEqual([]);
    });

    test("config 'database' installs the database store using the bound connection", () => {
      const app = makeApp({ features: { default: "database" } });
      app.instance("db", {});
      app.register(FeatureServiceProvider);
      expect(stores).toHaveLength(1);
      expect((stores[0] as object).constructor.name).toBe("DatabaseFeatureStore");
    });

    test("FEATURES_STORE=database works when config is silent, and config wins over the env var", () => {
      process.env.FEATURES_STORE = "database";
      const withEnv = makeApp();
      withEnv.instance("db", {});
      withEnv.register(FeatureServiceProvider);
      expect(stores).toHaveLength(1);

      const overridden = makeApp({ features: { default: "array" } });
      overridden.instance("db", {});
      overridden.register(FeatureServiceProvider);
      expect(stores).toHaveLength(1);
    });

    test("database store without a db binding fails loudly", () => {
      expect(() => makeApp({ features: { default: "database" } }).register(FeatureServiceProvider)).toThrow();
      expect(stores).toEqual([]);
    });
  });
});

describe("defaultCompilerPlugins", () => {
  test("keeps the plugin order and always ends with the server plugin", () => {
    const names = defaultCompilerPlugins({ routesEntries: ["a.ts", "b.ts"], applicationModule: "app.ts", optimize: true })
      .map((p) => p.name);
    expect(names).toEqual(["router", "middleware", "providers", "discovery", "config", "server"]);
  });

  test("a route-less setup still builds; the router plugin reports it at analyze time", async () => {
    const [router] = defaultCompilerPlugins({ applicationModule: "app.ts" });
    const diagnostics: { code: string; message: string }[] = [];
    await router!.analyze!({ root: dir, outDir: dir, diagnostics, ir: new Map() });
    expect(diagnostics.map((d) => d.code)).toEqual(["BUNYAD_ROUTE_001"]);
  });

  test("the server plugin points at the application module it was given", () => {
    const server = defaultCompilerPlugins({ routesEntry: "r.ts", applicationModule: join(dir, "bootstrap/app.ts") }).at(-1)!;
    const written: Record<string, string> = {};
    server.generate!({
      root: dir,
      outDir: join(dir, ".build"),
      diagnostics: [],
      ir: new Map(),
      writeModule: (_n, file, contents) => void (written[file] = contents),
      setManifestModule() {},
      setManifestMeta() {},
      setEntry() {},
    });
    expect(written["server.ts"]).toContain('from "../bootstrap/app.ts"');
  });
});

describe("auth notifications", () => {
  test("ResetPassword mail carries the link and expiry, and escapes the url", async () => {
    const mail = new ResetPassword("tok", 'https://app.test/reset?token=tok&email=a"b', 15).toMail();
    const message = await mail.toMessage({ email: "u@x.test" } as never);
    expect(message.to).toBe("u@x.test");
    expect(message.subject).toBe("Reset Password Notification");
    expect(message.html).toContain("15 minutes");
    expect(message.html).not.toContain('email=a"b');
    expect(message.html).toContain("token=tok&amp;email=a");
  });

  test("ResetPassword defaults to a 60 minute expiry", async () => {
    const message = await new ResetPassword("t", "https://a.test/r").toMail().toMessage({ email: "u@x.test" } as never);
    expect(message.html).toContain("60 minutes");
  });

  test("VerifyEmail mail has its own subject and link", async () => {
    const note = new VerifyEmail("https://a.test/verify/1");
    expect(note.url).toBe("https://a.test/verify/1");
    const message = await note.toMail().toMessage({ email: "u@x.test" } as never);
    expect(message.subject).toBe("Verify Email Address");
    expect(message.html).toContain("https://a.test/verify/1");
  });
});

describe("tokenGuardUsing", () => {
  type Row = { id: number; tokenable_id: number; tokenable_type: string; name: string; token: string; abilities: string; expires_at: number | null; delete(): Promise<void> };

  function fakeToken() {
    const rows = new Map<number, Row>();
    let next = 1;
    class Token {
      static async find(id: string | number) {
        return rows.get(Number(id)) ?? null;
      }
      static async create(data: Omit<Row, "id" | "delete">) {
        const row: Row = { ...data, id: next++, async delete() { rows.delete(row.id); } };
        rows.set(row.id, row);
        return row;
      }
    }
    return { Token: Token as never, rows };
  }

  const bearer = (token: string) =>
    new Request(new globalThis.Request("https://api.test/me", { headers: { authorization: `Bearer ${token}` } }));
  const users: Record<number, { id: number }> = { 7: { id: 7 } };
  const findUser = (id: string | number) => users[Number(id)] ?? null;

  test("createToken stores a hashed secret with defaults, and the plain token authenticates", async () => {
    const { Token, rows } = fakeToken();
    const guard = tokenGuardUsing({ Token, findUser });
    const plain = await guard.createToken({ id: 7 }, "cli");
    const [id, secret] = plain.split("|");
    const row = rows.get(Number(id))!;
    expect(row.tokenable_type).toBe("User");
    expect(row.name).toBe("cli");
    expect(row.abilities).toBe("*");
    expect(row.expires_at).toBeNull();
    expect(row.token).not.toBe(secret);
    expect(row.token).toHaveLength(64);

    const request = bearer(plain);
    expect(await guard.user(request)).toEqual({ id: 7 });
    expect(guard.currentAccessToken(request)?.id).toBe(Number(id));
    expect(guard.tokenCan(request, "anything")).toBe(true);
  });

  test("tokenableType, abilities and expiry are persisted and enforced", async () => {
    const { Token, rows } = fakeToken();
    const guard = tokenGuardUsing({ Token, findUser, tokenableType: "Admin" });
    const limited = await guard.createToken({ id: 7 }, "ro", ["posts:read"]);
    expect(rows.get(1)!.tokenable_type).toBe("Admin");
    const request = bearer(limited);
    await guard.user(request);
    expect(guard.tokenCan(request, "posts:read")).toBe(true);
    expect(guard.tokenCant(request, "posts:write")).toBe(true);

    const expiring = await guard.createToken({ id: 7 }, "short", { expiresAt: 5 });
    rows.get(2)!.expires_at = Math.floor(Date.now() / 1000) - 1;
    expect(await guard.user(bearer(expiring))).toBeNull();
  });

  test("wrong secret, unknown id, malformed bearer and missing user all fail closed", async () => {
    const { Token } = fakeToken();
    const guard = tokenGuardUsing({ Token, findUser: (id) => (Number(id) === 7 ? { id: 7 } : null) });
    const plain = await guard.createToken({ id: 7 });
    const [id] = plain.split("|");
    expect(await guard.user(bearer(`${id}|wrong`))).toBeNull();
    expect(await guard.user(bearer(`999|whatever`))).toBeNull();
    expect(await guard.user(bearer("no-separator"))).toBeNull();
    expect(await guard.user(bearer("abc|secret"))).toBeNull();

    const orphan = await guard.createToken({ id: 404 });
    expect(await guard.user(bearer(orphan))).toBeNull();
  });

  test("deleting the token record revokes access", async () => {
    const { Token, rows } = fakeToken();
    const guard = tokenGuardUsing({ Token, findUser });
    const plain = await guard.createToken({ id: 7 });
    expect(await guard.user(bearer(plain))).not.toBeNull();
    await rows.get(1)!.delete();
    expect(await guard.user(bearer(plain))).toBeNull();
  });

  test("attempt() needs findUserByCredentials", async () => {
    const guard = tokenGuardUsing({ Token: fakeToken().Token, findUser });
    await expect(guard.attempt({ email: "a@b.c", password: "x" })).rejects.toThrow("retrieveUserByCredentials");
  });

  test("attempt() checks the password hash, and rejects empty lookups and unknown users", async () => {
    const hashed = await Bun.password.hash("secret", { algorithm: "bcrypt", cost: 4 });
    const lookups: Record<string, unknown>[] = [];
    const guard = tokenGuardUsing({
      Token: fakeToken().Token,
      findUser,
      findUserByCredentials: (credentials) => {
        lookups.push(credentials);
        return credentials.email === "a@b.c" ? ({ id: 7, password: hashed } as never) : null;
      },
    });
    expect(await guard.attempt({ email: "a@b.c", password: "secret" })).toMatchObject({ id: 7 });
    expect(await guard.attempt({ email: "a@b.c", password: "nope" })).toBeNull();
    expect(await guard.attempt({ email: "x@y.z", password: "secret" })).toBeNull();
    expect(await guard.attempt({ password: "secret" })).toBeNull();
    // the password is never passed to the user lookup
    expect(lookups.every((l) => !("password" in l))).toBe(true);
    expect(lookups).toHaveLength(3);
  });
});
