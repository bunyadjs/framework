import { expect, test } from "bun:test";
import {
  dataGet,
  dataSet,
  dataFill,
  dataForget,
  BunyadError,
  blank,
  filled,
  dump,
  dd,
  postFlockDump,
  DdException,
  useDdThrow,
  runWithDdThrow,
  tap,
  value,
  withValue,
  when,
  optional,
  throw_if,
  throw_unless,
  retry,
  once,
  flushOnce,
  defer,
  flushDeferred,
  now,
  today,
  env,
  rescue,
  collect,
  Collection,
  Crypt,
  Fluent,
  Str,
  Arr,
} from "../src/index.ts";

test("dataGet reads nested keys", () => {
  expect(dataGet({ app: { name: "Bunyad" } }, "app.name")).toBe("Bunyad");
});

test("dataGet returns undefined for missing path", () => {
  expect(dataGet({ app: {} }, "app.name")).toBeUndefined();
});

test("dataGet default and dataSet dataFill dataForget", () => {
  expect(dataGet({}, "a.b", "x")).toBe("x");
  const target: Record<string, unknown> = {};
  dataSet(target, "user.profile.name", "Ada");
  expect(dataGet(target, "user.profile.name")).toBe("Ada");
  dataFill(target, "user.profile.name", "Grace");
  expect(dataGet(target, "user.profile.name")).toBe("Ada");
  dataFill(target, "user.profile.city", "London");
  expect(dataGet(target, "user.profile.city")).toBe("London");
  dataForget(target, "user.profile.city");
  expect(dataGet(target, "user.profile.city")).toBeUndefined();
});

test("BunyadError carries code", () => {
  const err = new BunyadError("boom", "BUNYAD_TEST_001");
  expect(err.code).toBe("BUNYAD_TEST_001");
  expect(err.message).toBe("boom");
});

test("blank and filled", () => {
  expect(blank(null)).toBe(true);
  expect(blank("")).toBe(true);
  expect(blank("  ")).toBe(true);
  expect(blank([])).toBe(true);
  expect(blank(collect())).toBe(true);
  expect(blank(0)).toBe(false);
  expect(blank(false)).toBe(false);
  expect(filled("a")).toBe(true);
  expect(filled(0)).toBe(true);
});

test("tap value withValue when optional", () => {
  const seen: number[] = [];
  expect(tap(5, (n) => seen.push(n))).toBe(5);
  expect(seen).toEqual([5]);

  expect(value(3)).toBe(3);
  expect(value(() => 7)).toBe(7);

  expect(withValue(2, (n) => n * 3)).toBe(6);
  expect(withValue(2)).toBe(2);

  expect(when(true, "yes", "no")).toBe("yes");
  expect(when(false, "yes", "no")).toBe("no");
  expect(when(true, () => "lazy")).toBe("lazy");

  expect(optional(null, (v) => v)).toBeNull();
  expect(optional("x", (v) => v.toUpperCase())).toBe("X");
  expect((optional(null) as { foo: unknown }).foo).toBeTruthy(); // proxy
  expect(optional("hi")).toBe("hi");
});

test("throw_if throw_unless", () => {
  expect(() => throw_if(false, "no")).not.toThrow();
  expect(() => throw_if(true, "boom")).toThrow("boom");
  expect(() => throw_unless(true, "no")).not.toThrow();
  expect(() => throw_unless(false, "boom")).toThrow("boom");
});

test("retry once defer rescue", async () => {
  let tries = 0;
  const result = await retry(3, async () => {
    tries += 1;
    if (tries < 3) throw new Error("fail");
    return "ok";
  });
  expect(result).toBe("ok");
  expect(tries).toBe(3);

  flushOnce();
  let n = 0;
  expect(once("compute", () => {
    n += 1;
    return "cached";
  })).toBe("cached");
  expect(once("compute", () => {
    n += 1;
    return "cached";
  })).toBe("cached");
  expect(n).toBe(1);

  const stable = () => {
    n += 1;
    return "fn";
  };
  expect(once(stable)).toBe("fn");
  expect(once(stable)).toBe("fn");
  expect(n).toBe(2);

  const deferred: string[] = [];
  defer(() => {
    deferred.push("a");
  });
  defer(() => {
    deferred.push("b");
  }).always();
  expect(deferred).toEqual([]);
  await flushDeferred();
  expect(deferred).toEqual(["a", "b"]);

  expect(
    rescue(
      () => {
        throw new Error("x");
      },
      "fallback",
      false,
    ),
  ).toBe("fallback");
});

test("now today env dump dd", () => {
  expect(now()).toBeInstanceOf(Date);
  const t = today();
  expect(t.getHours()).toBe(0);

  process.env.BUNYAD_TEST_ENV = "hello";
  expect(env("BUNYAD_TEST_ENV")).toBe("hello");
  expect(env("BUNYAD_MISSING_ENV", "def")).toBe("def");

  dump({ ok: true }); // should not throw

  useDdThrow(true);
  expect(() => dd(1, 2)).toThrow(DdException);
  useDdThrow(false);

  expect(
    runWithDdThrow(() => {
      try {
        dd("x");
      } catch (e) {
        return e instanceof DdException;
      }
      return false;
    }),
  ).toBe(true);
});

test("dump and dd POST to FLOCK_DUMP_URL", async () => {
  const posts: Array<{ url: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  process.env.FLOCK_DUMP_URL = "http://127.0.0.1:7979/v1/ingest";
  process.env.FLOCK_SITE = "shop";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    dump({ hello: 1 });
    await postFlockDump("dump", [{ hello: 1 }]);
    useDdThrow(true);
    try {
      dd("boom");
    } catch {
      // expected
    } finally {
      useDdThrow(false);
    }
    await Bun.sleep(30);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0]?.url).toBe("http://127.0.0.1:7979/v1/ingest");
    expect(posts.some((p) => p.body.includes("hello"))).toBe(true);
    expect(posts.some((p) => p.body.includes('"kind":"dd"'))).toBe(true);
    expect(posts.some((p) => p.body.includes("shop"))).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FLOCK_DUMP_URL;
    delete process.env.FLOCK_SITE;
  }
});

test("postFlockDump awaits promises so Flock gets the resolved value", async () => {
  const posts: string[] = [];
  const originalFetch = globalThis.fetch;
  process.env.FLOCK_DUMP_URL = "http://127.0.0.1:7979/v1/ingest";
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    posts.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await postFlockDump("dd", [Promise.resolve({ name: "Ada", id: 1 })]);
    expect(posts[0]).toContain("Ada");
    expect(posts[0]).toContain('"kind":"dd"');
    expect(posts[0]).toContain("sf-dump");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FLOCK_DUMP_URL;
  }
});

test("serializeDumpValue uses getAttributes on models", async () => {
  const { serializeDumpValue } = await import("./var-dumper.ts");
  const model = {
    constructor: { name: "User" },
    getAttributes() {
      return { id: 1, name: "Ada" };
    },
  };
  expect(serializeDumpValue(model)).toEqual({
    __class: "User",
    id: 1,
    name: "Ada",
  });
});

test("dd and dump are installed on globalThis", async () => {
  await import("./globals.ts");
  expect(typeof globalThis.dd).toBe("function");
  expect(typeof globalThis.dump).toBe("function");
  expect(typeof globalThis.collect).toBe("function");
  expect(typeof globalThis.blank).toBe("function");
  expect(typeof globalThis.env).toBe("function");
  expect(typeof globalThis.now).toBe("function");
  expect(typeof globalThis.tap).toBe("function");
});

test("ddHtmlPage renders Symfony-style dump chrome", async () => {
  const { ddHtmlPage, resolveDumpValues } = await import("./helpers.ts");
  const html = ddHtmlPage([{ name: "Ada", nested: { a: 1 } }]);
  expect(html).toContain("sf-dump");
  expect(html).toContain("sf-dump-str");
  expect(html).toContain("sf-dump-public");
  expect(html).toContain("Ada");
  expect(html).toContain("<style>");
  expect(html).toContain("sf-js-enabled");

  const resolved = await resolveDumpValues([Promise.resolve(42)]);
  expect(resolved).toEqual([42]);
});

test("ddHtmlPage labels collection items by class", async () => {
  const { ddHtmlPage } = await import("./helpers.ts");
  const { Collection } = await import("./collection.ts");

  class Category {
    constructor(public name: string) {}

    getAttributes(): { name: string } {
      return { name: this.name };
    }

    toJSON(): { name: string } {
      return { name: this.name };
    }
  }

  const html = ddHtmlPage([new Collection([new Category("Tea")])]);
  expect(html).toContain("sf-dump-note>Collection");
  expect(html).toContain("sf-dump-note>Category");
  expect(html).toContain("Tea");
  expect(html).not.toContain("sf-dump-note>Object");
});


test("Collection where sort partition join toJson", () => {
  const users = collect([
    { name: "a", age: 20 },
    { name: "b", age: 30 },
    { name: "c", age: 25 },
  ]);
  expect(users.where("age", ">=", 25).pluck("name").all()).toEqual(["b", "c"]);
  expect(users.sortBy("age").pluck("age").all()).toEqual([20, 25, 30]);
  // One-arg pluck → list Collection of values
  expect(users.pluck("name")).toBeInstanceOf(Collection);
  expect(users.pluck("name").all()).toEqual(["a", "b", "c"]);
  // Two-arg pluck → keyed plain object (Arr.pluck keyed form)
  const products = collect([
    { product_id: "prod-100", name: "Desk" },
    { product_id: "prod-200", name: "Chair" },
  ]);
  expect(products.pluck("name", "product_id")).toEqual({
    "prod-100": "Desk",
    "prod-200": "Chair",
  });
  // Duplicate keys keep last value
  expect(
    collect([
      { brand: "Tesla", color: "red" },
      { brand: "Pagani", color: "white" },
      { brand: "Tesla", color: "black" },
      { brand: "Pagani", color: "orange" },
    ]).pluck("color", "brand"),
  ).toEqual({ Tesla: "black", Pagani: "orange" });
  expect(users.whereBetween("age", [20, 25]).count()).toBe(2);
  expect(users.containsOneItem()).toBe(false);
  expect(collect([1]).containsOneItem()).toBe(true);
  expect(collect([1, 2, 3]).join(", ", " and ")).toBe("1, 2 and 3");
  expect(users.firstWhere("name", "b")).toEqual({ name: "b", age: 30 });
  expect(JSON.parse(users.take(1).toJson())).toEqual([{ name: "a", age: 20 }]);

  const [adults, minors] = collect([18, 21, 16]).partition((n) => n >= 18);
  expect(adults.all()).toEqual([18, 21]);
  expect(minors.all()).toEqual([16]);

  expect(Collection.range(1, 3).all()).toEqual([1, 2, 3]);
  expect(Collection.times(3, (i) => i * 2).all()).toEqual([2, 4, 6]);
  expect(collect([1, 2, 2, 3]).duplicates().all()).toEqual([2]);
  expect(collect([1, 2, 3]).after(2)).toBe(3);
  expect(collect([1, 2, 3]).before(2)).toBe(1);
  expect(collect([[1, 2], [3, 4]]).collapse().all()).toEqual([1, 2, 3, 4]);
  expect(collect([1, 2, 3]).mergeRecursive([4]).all()).toEqual([1, 2, 3, 4]);
  const seen: number[] = [];
  collect([1, 2]).forEach((n) => {
    seen.push(n);
  });
  expect(seen).toEqual([1, 2]);
});

test("Collection when unless sole ensure", () => {
  const c = collect([1, 2]);
  c.when(true, (col) => col.push(3));
  expect(c.all()).toEqual([1, 2, 3]);
  c.unless(false, (col) => col.push(4));
  expect(c.all()).toEqual([1, 2, 3, 4]);
  expect(collect([9]).sole()).toBe(9);
  expect(() => collect([1, 2]).sole()).toThrow();
  expect(collect(["a", "b"]).ensure("string").count()).toBe(2);
  expect(() => collect(["a", 1]).ensure("string")).toThrow();
});

test("Crypt encryptString decryptString generateKey", () => {
  const key = Crypt.generateKey();
  expect(key.startsWith("base64:")).toBe(true);
  expect(Crypt.supported(key)).toBe(true);
  Crypt.setKey(key);
  try {
    const enc = Crypt.encryptString("secret");
    expect(Crypt.appearsEncrypted(enc)).toBe(true);
    expect(Crypt.decryptString(enc)).toBe("secret");
    expect(Crypt.encrypt("x")).not.toBe("x");
    expect(Crypt.decrypt(Crypt.encrypt("y"))).toBe("y");
  } finally {
    Crypt.clearKey();
  }
});

test("Crypt refuses missing APP_KEY in production", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevApp = process.env.APP_ENV;
  const prevKey = process.env.APP_KEY;
  Crypt.clearKey();
  delete process.env.APP_KEY;
  process.env.NODE_ENV = "production";
  delete process.env.APP_ENV;
  try {
    expect(() => Crypt.encryptString("x")).toThrow(/APP_KEY/);
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevApp === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = prevApp;
    if (prevKey === undefined) delete process.env.APP_KEY;
    else process.env.APP_KEY = prevKey;
  }
});

test("Crypt encrypt decrypt with explicit setKey", () => {
  Crypt.setKey("explicit-test-key-32bytes-long!!");
  try {
    const enc = Crypt.encrypt("round-trip");
    expect(Crypt.decrypt(enc)).toBe("round-trip");
  } finally {
    Crypt.clearKey();
  }
});

test("Fluent typed accessors and whenHas", () => {
  const f = Fluent.make({ name: "Ada", age: "37", active: "1", tags: ["a"] });
  expect(f.string("name")).toBe("Ada");
  expect(f.integer("age")).toBe(37);
  expect(f.boolean("active")).toBe(true);
  expect(f.array("tags")).toEqual(["a"]);
  expect(f.filled("name")).toBe(true);
  expect(f.anyFilled("missing", "name")).toBe(true);
  expect(f.hasAny("nope", "name")).toBe(true);
  let hit = false;
  f.whenHas("name", () => {
    hit = true;
  });
  expect(hit).toBe(true);
  expect(JSON.parse(f.toJson()).name).toBe("Ada");
});

test("fromOwned skips copy and all() returns live items", () => {
  const owned = [1, 2, 3];
  const c = Collection.fromOwned(owned);
  expect(c.all()).toBe(owned);
  owned.push(4);
  expect(c.all()).toEqual([1, 2, 3, 4]);

  const input = [9];
  const copied = new Collection(input);
  expect(copied.all()).not.toBe(input);
  expect(copied.all()).toBe(copied.all());
});

test("numeric index access via Proxy", () => {
  const c = Collection.fromOwned(["a", "b", "c"]) as unknown as Record<
    number,
    string | undefined
  > &
    Collection<string>;
  expect(c[0]).toBe("a");
  expect(c[2]).toBe("c");
  expect(c[9]).toBeUndefined();
  expect(c.map).toBeTypeOf("function");
});

test("Str slug snake camel studly and helpers", () => {
  expect(Str.slug("Hello World!")).toBe("hello-world");
  expect(Str.snake("HelloWorld")).toBe("hello_world");
  expect(Str.camel("hello_world")).toBe("helloWorld");
  expect(Str.studly("hello-world")).toBe("HelloWorld");
  expect(Str.kebab("HelloWorld")).toBe("hello-world");
  expect(Str.contains("foobar", "oob")).toBe(true);
  expect(Str.startsWith("foobar", "foo")).toBe(true);
  expect(Str.endsWith("foobar", "bar")).toBe(true);
  expect(Str.before("a/b/c", "/")).toBe("a");
  expect(Str.afterLast("a/b/c", "/")).toBe("c");
  expect(Str.limit("abcdef", 4, "")).toBe("abcd");
  expect(Str.is("foo*", "foobar")).toBe(true);
  expect(Str.isUuid(Str.uuid())).toBe(true);
  expect(Str.isUlid(Str.ulid())).toBe(true);
  expect(Str.of("Hello World").slug().toString()).toBe("hello-world");
  expect(Str.squish("  a   b  ")).toBe("a b");
});

test("Arr get set only except wrap flatten dot", () => {
  const data = { a: { b: 1 }, c: 2 };
  expect(Arr.get<number>(data, "a.b")).toBe(1);
  Arr.set(data, "a.d", 3);
  expect(Arr.get<number>(data, "a.d")).toBe(3);
  expect(Arr.only(data, ["c"])).toEqual({ c: 2 });
  expect(Arr.except({ x: 1, y: 2 }, ["y"])).toEqual({ x: 1 });
  expect(Arr.wrap("a")).toEqual(["a"]);
  expect(Arr.wrap(null)).toEqual([]);
  expect(Arr.flatten([1, [2, [3]]], 1)).toEqual([1, 2, [3]]);
  expect(Arr.dot({ a: { b: 1 } })).toEqual({ "a.b": 1 });
  expect(Arr.undot({ "a.b": 1 })).toEqual({ a: { b: 1 } });
  expect(Arr.pluck([{ id: 1, n: "a" }], "n")).toEqual(["a"]);
  expect(Arr.pluck([{ id: 1, n: "a" }, { id: 2, n: "b" }], "n", "id")).toEqual({
    "1": "a",
    "2": "b",
  });
  expect(Arr.join(["a", "b", "c"], ", ", " and ")).toBe("a, b and c");
  expect(Arr.has(data, "a.b")).toBe(true);
});

test("dataSet refuses paths that reach Object.prototype", () => {
  try {
    const target: Record<string, unknown> = {};
    dataSet(target, "__proto__.polluted", true);
    dataSet(target, "a.constructor.prototype.polluted", true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(target).toEqual({});
  } finally {
    delete (Object.prototype as Record<string, unknown>).polluted;
  }
});
