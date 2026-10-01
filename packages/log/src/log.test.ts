import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConsoleChannel,
  DailyChannel,
  Log,
  SingleChannel,
  StackChannel,
  resetLogChannelsForTests,
  setLogChannel,
} from "./index.ts";

afterEach(async () => {
  await Log.flush().catch(() => undefined);
  resetLogChannelsForTests();
});

describe("Log", () => {
  test("writes to a single file channel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-log-"));
    const path = join(dir, "app.log");
    setLogChannel(new SingleChannel({ path, level: "debug" }));

    Log.info("hello", { user: 1 });
    Log.error("boom");
    await Log.flush();

    const body = await readFile(path, "utf8");
    expect(body).toContain("INFO: hello");
    expect(body).toContain('"user":1');
    expect(body).toContain("ERROR: boom");

    await rm(dir, { recursive: true, force: true });
  });

  test("daily writes dated file and respects level", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-log-"));
    const path = join(dir, "app.log");
    setLogChannel(new DailyChannel({ path, level: "warning", days: 14 }));

    Log.info("skip me");
    Log.warning("keep me");
    await Log.flush();

    const day = new Date().toISOString().slice(0, 10);
    const dated = join(dir, `app-${day}.log`);
    const body = await readFile(dated, "utf8");
    expect(body).not.toContain("skip me");
    expect(body).toContain("WARNING: keep me");

    await rm(dir, { recursive: true, force: true });
  });

  test("daily prunes files older than days", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-log-"));
    const path = join(dir, "app.log");
    const oldDay = "2020-01-01";
    const oldFile = join(dir, `app-${oldDay}.log`);
    await writeFile(oldFile, "stale\n", "utf8");

    setLogChannel(new DailyChannel({ path, level: "debug", days: 7 }));
    Log.info("fresh");
    await Log.flush();

    const names = await readdir(dir);
    expect(names.some((n) => n.includes(oldDay))).toBe(false);
    expect(names.some((n) => n.startsWith("app-") && n.endsWith(".log"))).toBe(
      true,
    );

    await rm(dir, { recursive: true, force: true });
  });

  test("stack fans out and respects level", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-log-"));
    const path = join(dir, "app.log");
    const single = new SingleChannel({ path, level: "debug" });
    setLogChannel(
      new StackChannel({
        channels: [single, new ConsoleChannel({ level: "error" })],
        level: "warning",
      }),
    );

    Log.info("skip me");
    Log.warning("keep me");
    await Log.flush();

    const body = await readFile(path, "utf8");
    expect(body).not.toContain("skip me");
    expect(body).toContain("WARNING: keep me");

    await rm(dir, { recursive: true, force: true });
  });

  test("Log.channel selects a named channel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-log-"));
    const path = join(dir, "named.log");
    setLogChannel(new ConsoleChannel({ level: "debug" }), "default");
    setLogChannel(new SingleChannel({ path }), "single");

    Log.channel("single").info("named");
    await Log.flush();
    const body = await readFile(path, "utf8");
    expect(body).toContain("INFO: named");

    await rm(dir, { recursive: true, force: true });
  });

  test("shareContext merges into subsequent log lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-log-"));
    const path = join(dir, "app.log");
    setLogChannel(new SingleChannel({ path, level: "debug" }));

    Log.shareContext({ request_id: "r1" });
    Log.info("with shared");
    Log.withContext({ user_id: 2 });
    Log.info("with both");
    Log.withoutContext();
    Log.info("cleared");
    await Log.flush();

    const body = await readFile(path, "utf8");
    expect(body).toContain('"request_id":"r1"');
    expect(body).toContain('"user_id":2');
    const lines = body.trim().split("\n");
    expect(lines[2]).not.toContain("request_id");

    await rm(dir, { recursive: true, force: true });
  });

  test("level methods return void and flush drains the queue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-log-"));
    const path = join(dir, "app.log");
    setLogChannel(new SingleChannel({ path, level: "debug" }));

    const ret = Log.info("queued");
    expect(ret).toBeUndefined();
    await Log.flush();

    const body = await readFile(path, "utf8");
    expect(body).toContain("INFO: queued");

    await rm(dir, { recursive: true, force: true });
  });
});
