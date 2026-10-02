import { afterEach, beforeEach, describe, expect, spyOn, test, setSystemTime } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConsoleChannel,
  DailyChannel,
  Log,
  SingleChannel,
  StackChannel,
  getLogChannel,
  levelWeight,
  parseLevel,
  resetLogChannelsForTests,
  setDefaultLogChannel,
  setLogChannel,
  shouldLog,
  type LogChannel,
  type LogLevel,
} from "./index.ts";

type Entry = { level: LogLevel; message: string; context?: Record<string, unknown> };

function recorder(): LogChannel & { entries: Entry[] } {
  const entries: Entry[] = [];
  return {
    entries,
    log(level, message, context) {
      entries.push({ level, message, context });
    },
  };
}

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "bunyad-log-b-"));
  dirs.push(d);
  return d;
}

beforeEach(() => {
  resetLogChannelsForTests();
});

afterEach(async () => {
  setSystemTime();
  await Log.flush().catch(() => undefined);
  resetLogChannelsForTests();
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe("levels", () => {
  test("weights are strictly increasing in severity order", () => {
    const order: LogLevel[] = [
      "debug", "info", "notice", "warning", "error", "critical", "alert", "emergency",
    ];
    for (let i = 1; i < order.length; i++) {
      expect(levelWeight(order[i]!)).toBeGreaterThan(levelWeight(order[i - 1]!));
    }
  });

  test("parseLevel is case-insensitive and falls back for junk or empty", () => {
    expect(parseLevel("ERROR", "debug")).toBe("error");
    expect(parseLevel("Warning", "debug")).toBe("warning");
    expect(parseLevel("verbose", "info")).toBe("info");
    expect(parseLevel("", "notice")).toBe("notice");
    expect(parseLevel(undefined, "alert")).toBe("alert");
  });

  test("parseLevel does not accept inherited object keys", () => {
    expect(parseLevel("constructor", "info")).toBe("info");
    expect(parseLevel("toString", "info")).toBe("info");
  });

  test("shouldLog is inclusive at the threshold", () => {
    expect(shouldLog("warning", "warning")).toBe(true);
    expect(shouldLog("notice", "warning")).toBe(false);
    expect(shouldLog("emergency", "debug")).toBe(true);
  });
});

describe("channels", () => {
  test("single channel line format: ISO stamp, uppercased level, JSON context", async () => {
    setSystemTime(new Date("2026-03-10T12:34:56.789Z"));
    const dir = await tmp();
    const path = join(dir, "nested", "deeper", "app.log");
    const ch = new SingleChannel({ path });
    await ch.log("notice", "hi", { a: 1, b: [2] });
    expect(await readFile(path, "utf8")).toBe(
      '[2026-03-10T12:34:56.789Z] NOTICE: hi {"a":1,"b":[2]}\n',
    );
  });

  test("an empty or missing context adds no trailing JSON", async () => {
    const dir = await tmp();
    const path = join(dir, "app.log");
    const ch = new SingleChannel({ path });
    await ch.log("info", "plain");
    await ch.log("info", "empty", {});
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines[0]).toEndWith("INFO: plain");
    expect(lines[1]).toEndWith("INFO: empty");
  });

  test("single channel appends to an existing file and filters by string level", async () => {
    const dir = await tmp();
    const path = join(dir, "app.log");
    await writeFile(path, "existing\n");
    const ch = new SingleChannel({ path, level: "ERROR" });
    await ch.log("warning", "dropped");
    await ch.log("critical", "kept");
    const body = await readFile(path, "utf8");
    expect(body.startsWith("existing\n")).toBe(true);
    expect(body).not.toContain("dropped");
    expect(body).toContain("CRITICAL: kept");
  });

  test("an unrecognised level option falls back to debug (logs everything)", async () => {
    const dir = await tmp();
    const path = join(dir, "app.log");
    const ch = new SingleChannel({ path, level: "loud" });
    await ch.log("debug", "d");
    expect(await readFile(path, "utf8")).toContain("DEBUG: d");
  });

  test("concurrent writes on a fresh single channel all land", async () => {
    const dir = await tmp();
    const path = join(dir, "fresh", "app.log");
    const ch = new SingleChannel({ path });
    await Promise.all(Array.from({ length: 20 }, (_, i) => ch.log("info", `m${i}`)));
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(20);
  });

  test("daily channel names the file by UTC date and rolls over at midnight", async () => {
    const dir = await tmp();
    const ch = new DailyChannel({ path: join(dir, "app.log") });
    setSystemTime(new Date("2026-03-10T23:59:59.000Z"));
    await ch.log("info", "before");
    setSystemTime(new Date("2026-03-11T00:00:01.000Z"));
    await ch.log("info", "after");
    const names = (await readdir(dir)).sort();
    expect(names).toEqual(["app-2026-03-10.log", "app-2026-03-11.log"]);
    expect(await readFile(join(dir, "app-2026-03-11.log"), "utf8")).toContain("after");
  });

  test("daily prune keeps files inside the window and ignores unrelated files", async () => {
    const dir = await tmp();
    setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    const files = [
      "app-2026-02-01.log", // old, matches -> pruned
      "app-2026-03-09.log", // recent -> kept
      "other-2026-01-01.log", // different stem -> kept
      "app-notadate.log", // malformed day -> kept
      "app-2026-01-01.txt", // wrong extension -> kept
    ];
    for (const f of files) await writeFile(join(dir, f), "x\n");

    const ch = new DailyChannel({ path: join(dir, "app.log"), days: 7 });
    await ch.log("info", "now");
    const names = new Set(await readdir(dir));
    expect(names.has("app-2026-02-01.log")).toBe(false);
    for (const keep of files.slice(1)) expect(names.has(keep)).toBe(true);
    expect(names.has("app-2026-03-10.log")).toBe(true);
  });

  test("daily prune runs once per calendar day", async () => {
    const dir = await tmp();
    setSystemTime(new Date("2026-03-10T08:00:00.000Z"));
    const ch = new DailyChannel({ path: join(dir, "app.log"), days: 3 });
    await ch.log("info", "first");

    await writeFile(join(dir, "app-2020-01-01.log"), "stale\n");
    setSystemTime(new Date("2026-03-10T20:00:00.000Z"));
    await ch.log("info", "same day");
    expect(await readdir(dir)).toContain("app-2020-01-01.log");

    setSystemTime(new Date("2026-03-11T08:00:00.000Z"));
    await ch.log("info", "next day");
    expect(await readdir(dir)).not.toContain("app-2020-01-01.log");
  });

  test("daily days option is clamped to at least one day", async () => {
    const dir = await tmp();
    setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    await writeFile(join(dir, "app-2026-03-10.log"), "today\n");
    const ch = new DailyChannel({ path: join(dir, "app.log"), days: -5 });
    await ch.log("info", "x");
    // Without clamping, a negative window puts the cutoff in the future and today's file is pruned.
    expect(await readdir(dir)).toContain("app-2026-03-10.log");
    expect(await readFile(join(dir, "app-2026-03-10.log"), "utf8")).toContain("today");
  });

  test("daily channel strips the .log suffix case-insensitively", async () => {
    const dir = await tmp();
    setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    const ch = new DailyChannel({ path: join(dir, "audit.LOG") });
    await ch.log("info", "x");
    expect(await readdir(dir)).toEqual(["audit-2026-03-10.log"]);
  });

  test("stack applies its own level before delegating, children keep theirs", async () => {
    const inner = recorder();
    const strict = new StackChannel({ channels: [inner], level: "error" });
    await strict.log("warning", "no");
    await strict.log("error", "yes", { k: 1 });
    expect(inner.entries).toEqual([
      { level: "error", message: "yes", context: { k: 1 } },
    ]);
  });

  test("stack waits for async children and propagates their failure", async () => {
    let finished = false;
    const slow: LogChannel = {
      async log() {
        await new Promise((r) => setTimeout(r, 10));
        finished = true;
      },
    };
    await new StackChannel({ channels: [slow] }).log("info", "x");
    expect(finished).toBe(true);

    const broken: LogChannel = {
      log() {
        throw new Error("disk full");
      },
    };
    expect(() => new StackChannel({ channels: [broken] }).log("info", "x")).toThrow();
  });

  test("console channel routes error-and-above to stderr, the rest to stdout", () => {
    const out = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      const ch = new ConsoleChannel();
      for (const l of ["debug", "info", "notice", "warning"] as const) ch.log(l, l);
      for (const l of ["error", "critical", "alert", "emergency"] as const) ch.log(l, l);
      expect(out).toHaveBeenCalledTimes(4);
      expect(err).toHaveBeenCalledTimes(4);
      expect(String(err.mock.calls[0]![0])).toContain("ERROR: error");
      expect(String(out.mock.calls[3]![0])).not.toEndWith("\n");
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  });

  test("console channel respects its level", () => {
    const out = spyOn(console, "log").mockImplementation(() => {});
    try {
      new ConsoleChannel({ level: "warning" }).log("info", "quiet");
      expect(out).not.toHaveBeenCalled();
    } finally {
      out.mockRestore();
    }
  });
});

describe("Log facade", () => {
  test("getLogChannel throws when nothing registered or name unknown", () => {
    expect(() => getLogChannel()).toThrow(/has not been set/);
    setLogChannel(recorder());
    expect(() => getLogChannel("nope")).toThrow(/\[nope\] is not defined/);
  });

  test("first named channel becomes the default until 'default' is set", () => {
    const a = recorder();
    const b = recorder();
    const c = recorder();
    setLogChannel(a, "a");
    setLogChannel(b, "b");
    expect(getLogChannel()).toBe(a);
    setLogChannel(c); // name defaults to "default"
    expect(getLogChannel()).toBe(c);
    setDefaultLogChannel("b");
    expect(getLogChannel()).toBe(b);
    expect(() => setDefaultLogChannel("missing")).toThrow(/not defined/);
  });

  test("Log.log dispatches arbitrary levels and writes keep call order", async () => {
    const rec = recorder();
    setLogChannel(rec);
    Log.log("alert", "one");
    Log.debug("two");
    Log.emergency("three");
    await Log.flush();
    expect(rec.entries.map((e) => `${e.level}:${e.message}`)).toEqual([
      "alert:one",
      "debug:two",
      "emergency:three",
    ]);
  });

  test("call-site context wins over shared context on key collisions", async () => {
    const rec = recorder();
    setLogChannel(rec);
    Log.shareContext({ user: "shared", req: "r1" });
    Log.info("m", { user: "local" });
    await Log.flush();
    expect(rec.entries[0]!.context).toEqual({ user: "local", req: "r1" });
  });

  test("context is snapshotted when the call is made, not when it is flushed", async () => {
    const rec = recorder();
    setLogChannel(rec);
    Log.shareContext({ phase: "before" });
    Log.info("first");
    Log.shareContext({ phase: "after" });
    Log.info("second");
    await Log.flush();
    expect(rec.entries.map((e) => e.context!.phase)).toEqual(["before", "after"]);
  });

  test("without shared context the caller's context object is passed through", async () => {
    const rec = recorder();
    setLogChannel(rec);
    Log.info("no ctx");
    await Log.flush();
    expect(rec.entries[0]!.context).toBeUndefined();
  });

  test("sharedContext() returns a copy that cannot mutate the bag", () => {
    Log.shareContext({ a: 1 });
    const snap = Log.sharedContext();
    snap.a = 999;
    expect(Log.sharedContext()).toEqual({ a: 1 });
  });

  test("a throwing channel does not break later writes or reject flush", async () => {
    let calls = 0;
    const flaky: LogChannel = {
      log(_l, message) {
        calls++;
        if (message === "bad") throw new Error("boom");
      },
    };
    setLogChannel(flaky);
    Log.info("bad");
    Log.info("good");
    await expect(Log.flush()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });

  test("a rejecting async channel is swallowed too", async () => {
    const rec = recorder();
    let first = true;
    setLogChannel({
      async log(l, m, c) {
        if (first) {
          first = false;
          throw new Error("async boom");
        }
        rec.log(l, m, c);
      },
    });
    Log.info("lost");
    Log.info("kept");
    await Log.flush();
    expect(rec.entries.map((e) => e.message)).toEqual(["kept"]);
  });

  test("Log.channel() shares the global context bag and queue", async () => {
    const def = recorder();
    const other = recorder();
    setLogChannel(def);
    setLogChannel(other, "other");
    const api = Log.channel("other");
    api.shareContext({ trace: "t" });
    api.warning("w");
    Log.info("i");
    await api.flush();
    expect(other.entries[0]).toMatchObject({ level: "warning", context: { trace: "t" } });
    expect(def.entries[0]!.context).toEqual({ trace: "t" });
    api.withoutContext();
    expect(Log.sharedContext()).toEqual({});
  });

  test("Log.channel() with an unknown name throws immediately", () => {
    setLogChannel(recorder());
    expect(() => Log.channel("ghost")).toThrow(/not defined/);
  });

  test("logging before any channel is registered throws synchronously", () => {
    expect(() => Log.info("x")).toThrow(/has not been set/);
  });

  test("resetLogChannelsForTests clears channels and shared context", () => {
    setLogChannel(recorder());
    Log.shareContext({ a: 1 });
    resetLogChannelsForTests();
    expect(Log.sharedContext()).toEqual({});
    expect(() => getLogChannel()).toThrow();
  });
});
