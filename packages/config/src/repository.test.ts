import { afterEach, describe, expect, test } from "bun:test";
import { Config, ConfigRepository, config, setConfigInstance } from "./index.ts";

describe("get / has", () => {
  test("missing keys return undefined or the supplied default", () => {
    const c = new ConfigRepository({ app: { name: "x" } });
    expect(c.get<unknown>("app.missing")).toBeUndefined();
    expect(c.get("nope.deeper.still", "fallback")).toBe("fallback");
  });

  test("falsy stored values are returned, not replaced by the default", () => {
    const c = new ConfigRepository({ a: { zero: 0, off: false, empty: "" } });
    expect(c.get("a.zero", 5)).toBe(0);
    expect(c.get("a.off", true)).toBe(false);
    expect(c.get("a.empty", "d")).toBe("");
  });

  test("an explicit null is kept (only undefined triggers the default)", () => {
    const c = new ConfigRepository({ a: { n: null } });
    expect(c.get("a.n", "d")).toBeNull();
    expect(c.has("a.n")).toBe(true);
  });

  test("has() is false for missing paths and for paths through scalars", () => {
    const c = new ConfigRepository({ a: { b: 1 } });
    expect(c.has("a.b")).toBe(true);
    expect(c.has("a.c")).toBe(false);
    expect(c.has("a.b.c")).toBe(false);
    expect(c.has("z")).toBe(false);
  });

  test("get() can descend into arrays by index", () => {
    const c = new ConfigRepository({ servers: [{ host: "a" }, { host: "b" }] });
    expect(c.get<unknown>("servers.1.host")).toBe("b");
  });

  test("getMany() returns every requested key, undefined for unknown ones", () => {
    const c = new ConfigRepository({ a: { b: 1 } });
    const out = c.getMany(["a.b", "a.x"]);
    expect(out).toEqual({ "a.b": 1, "a.x": undefined });
    expect(Object.keys(out)).toEqual(["a.b", "a.x"]);
  });
});

describe("set", () => {
  test("creates intermediate objects", () => {
    const c = new ConfigRepository();
    c.set("a.b.c", 1);
    expect(c.all()).toEqual({ a: { b: { c: 1 } } });
  });

  test("overwrites a scalar in the path with an object", () => {
    const c = new ConfigRepository({ a: "scalar" });
    c.set("a.b", 2);
    expect(c.get<unknown>("a")).toEqual({ b: 2 });
  });

  test("overwrites a null in the path", () => {
    const c = new ConfigRepository({ a: null });
    c.set("a.b", 2);
    expect(c.get<unknown>("a.b")).toBe(2);
  });

  test("sibling keys survive a nested set", () => {
    const c = new ConfigRepository({ a: { keep: true } });
    c.set("a.add", 1);
    expect(c.get<unknown>("a")).toEqual({ keep: true, add: 1 });
  });

  test("set() mutates the object passed to the constructor (shared reference)", () => {
    const items: Record<string, unknown> = { a: 1 };
    const c = new ConfigRepository(items);
    c.set("b", 2);
    expect(items).toEqual({ a: 1, b: 2 });
    expect(c.all()).toBe(items);
  });

  test("a value set to undefined makes has() false", () => {
    const c = new ConfigRepository({ a: 1 });
    c.set("a", undefined);
    expect(c.has("a")).toBe(false);
  });
});

describe("typed getters", () => {
  test("string() stringifies scalars and honours default for missing/null", () => {
    const c = new ConfigRepository({ a: { n: 5, t: true, nil: null } });
    expect(c.string("a.n")).toBe("5");
    expect(c.string("a.t")).toBe("true");
    expect(c.string("a.nil", "dflt")).toBe("dflt");
    expect(c.string("a.none")).toBe("");
    expect(c.string("a.none", "dflt")).toBe("dflt");
  });

  test("integer() truncates, parses leading digits, and defaults on garbage", () => {
    const c = new ConfigRepository({
      v: { f: 3.9, s: "42px", bad: "abc", empty: "", neg: "-7", nil: null, nan: Number.NaN },
    });
    expect(c.integer("v.f")).toBe(3);
    expect(c.integer("v.s")).toBe(42);
    expect(c.integer("v.neg")).toBe(-7);
    expect(c.integer("v.bad", 9)).toBe(9);
    expect(c.integer("v.empty", 9)).toBe(9);
    expect(c.integer("v.nil", 9)).toBe(9);
    expect(c.integer("v.nan", 9)).toBe(9);
    expect(c.integer("v.absent")).toBe(0);
  });

  test("float() parses decimals and defaults on garbage or infinity", () => {
    const c = new ConfigRepository({
      v: { s: "2.5e1", bad: "x", inf: Number.POSITIVE_INFINITY, n: 0.1 },
    });
    expect(c.float("v.s")).toBe(25);
    expect(c.float("v.n")).toBe(0.1);
    expect(c.float("v.bad", 1.5)).toBe(1.5);
    expect(c.float("v.inf", 2)).toBe(2);
    expect(c.float("v.absent", 0.25)).toBe(0.25);
  });

  test("boolean() accepts the usual truthy spellings and rejects the rest", () => {
    const c = new ConfigRepository({
      b: {
        one: "1", t: "TRUE", on: "On", yes: "yes",
        zero: "0", f: "false", off: "off", no: "no", junk: "maybe",
        num1: 1, num0: 0, numNeg: -1, real: true, realFalse: false,
      },
    });
    for (const k of ["one", "t", "on", "yes", "num1", "numNeg", "real"]) {
      expect(c.boolean(`b.${k}`)).toBe(true);
    }
    for (const k of ["zero", "f", "off", "no", "junk", "num0", "realFalse"]) {
      expect(c.boolean(`b.${k}`, true)).toBe(false);
    }
  });

  test("boolean() default applies to missing, null and empty string", () => {
    const c = new ConfigRepository({ b: { nil: null, empty: "" } });
    expect(c.boolean("b.nil", true)).toBe(true);
    expect(c.boolean("b.empty", true)).toBe(true);
    expect(c.boolean("b.absent")).toBe(false);
  });

  test("array() returns arrays as-is, object values for maps, default otherwise", () => {
    const list = [1, 2];
    const c = new ConfigRepository({
      x: { list, map: { a: "A", b: "B" }, str: "nope", nil: null },
    });
    expect(c.array("x.list")).toBe(list);
    expect(c.array("x.map")).toEqual(["A", "B"]);
    expect(c.array("x.str", ["d"])).toEqual(["d"]);
    expect(c.array("x.nil", ["d"])).toEqual(["d"]);
    expect(c.array("x.absent")).toEqual([]);
  });

  test("collection() wraps array() output", () => {
    const c = new ConfigRepository({ x: { a: 1, b: 2 } });
    expect(c.collection("x").all()).toEqual([1, 2]);
    expect(c.collection("missing").all()).toEqual([]);
  });
});

describe("prepend / push", () => {
  test("operate on a missing key by creating the array", () => {
    const c = new ConfigRepository();
    c.push("list", "a");
    c.prepend("other.list", "z");
    expect(c.get<unknown>("list")).toEqual(["a"]);
    expect(c.get<unknown>("other.list")).toEqual(["z"]);
  });

  test("do not mutate the previously stored array instance", () => {
    const original = ["b"];
    const c = new ConfigRepository({ list: original });
    c.push("list", "c");
    c.prepend("list", "a");
    expect(original).toEqual(["b"]);
    expect(c.get<unknown>("list")).toEqual(["a", "b", "c"]);
  });

  test("a map-valued key is flattened to its values", () => {
    const c = new ConfigRepository({ m: { x: 1, y: 2 } });
    c.push("m", 3);
    expect(c.get<unknown>("m")).toEqual([1, 2, 3]);
  });
});

describe("default instance and facade", () => {
  afterEach(() => {
    setConfigInstance(new ConfigRepository());
  });

  test("setConfigInstance swaps the backing repository", () => {
    setConfigInstance(new ConfigRepository({ a: 1 }));
    expect(config<unknown>("a")).toBe(1);
    setConfigInstance(new ConfigRepository({ a: 2 }));
    expect(Config.get<unknown>("a")).toBe(2);
  });

  test("facade defaults are forwarded to the repository", () => {
    setConfigInstance(new ConfigRepository());
    expect(config("nope", "d")).toBe("d");
    expect(Config.string("nope", "s")).toBe("s");
    expect(Config.integer("nope", 4)).toBe(4);
    expect(Config.float("nope", 1.5)).toBe(1.5);
    expect(Config.boolean("nope", true)).toBe(true);
    expect(Config.array("nope", ["x"])).toEqual(["x"]);
  });

  test("facade omitting a default behaves like the repository's own default", () => {
    setConfigInstance(new ConfigRepository());
    expect(Config.string("nope")).toBe("");
    expect(Config.integer("nope")).toBe(0);
    expect(Config.boolean("nope")).toBe(false);
    expect(Config.array("nope")).toEqual([]);
  });

  test("facade writes are visible through the helper and all()", () => {
    setConfigInstance(new ConfigRepository());
    Config.set("db.host", "localhost");
    Config.push("db.replicas", "r1");
    expect(config<unknown>("db.host")).toBe("localhost");
    expect(Config.has("db.replicas")).toBe(true);
    expect(Config.getMany(["db.host"])).toEqual({ "db.host": "localhost" });
    expect(Config.all()).toEqual({ db: { host: "localhost", replicas: ["r1"] } });
  });

  test("two repositories are independent", () => {
    const a = new ConfigRepository({ k: 1 });
    const b = new ConfigRepository({ k: 2 });
    a.set("k", 10);
    expect(b.get<unknown>("k")).toBe(2);
  });
});

test("set() refuses to write through __proto__, constructor or prototype", () => {
  try {
    const repo = new ConfigRepository();
    repo.set("__proto__.polluted", true);
    repo.set("constructor.prototype.polluted", true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(repo.all()).toEqual({});
  } finally {
    delete (Object.prototype as Record<string, unknown>).polluted;
  }
});
