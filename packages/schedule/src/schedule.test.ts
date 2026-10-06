import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cronMatches,
  Schedule,
  setSchedule,
  schedule,
  setScheduleJobRunner,
  setScheduleCommandRunner,
  setScheduleMutexStore,
  setScheduleMailSender,
  acquireMutex,
  releaseMutex,
  zonedParts,
  wrapScheduledRuns,
} from "../src/index.ts";

test("cronMatches every minute and hourly", () => {
  const d = new Date(2026, 0, 15, 14, 0, 0); // Thu
  expect(cronMatches("* * * * *", d)).toBe(true);
  expect(cronMatches("0 * * * *", d)).toBe(true);
  expect(cronMatches("5 * * * *", d)).toBe(false);
  expect(cronMatches("*/15 * * * *", new Date(2026, 0, 15, 14, 30, 0))).toBe(
    true,
  );
});

test("cronMatches respects timezone", () => {
  // 2026-01-01 05:00 UTC == 00:00 America/New_York (EST)
  const utc = new Date(Date.UTC(2026, 0, 1, 5, 0, 0));
  const parts = zonedParts(utc, "America/New_York");
  expect(parts.hours).toBe(0);
  expect(parts.minutes).toBe(0);
  expect(cronMatches("0 0 * * *", utc, "America/New_York")).toBe(true);
  expect(cronMatches("0 0 * * *", utc, "UTC")).toBe(false);
});

test("schedule runs due events", async () => {
  setScheduleMutexStore(undefined);
  const log: string[] = [];
  const s = new Schedule();
  setSchedule(s);

  schedule()
    .call(() => {
      log.push("a");
    })
    .everyMinute()
    .name("alpha");

  schedule()
    .call(() => {
      log.push("b");
    })
    .hourly()
    .name("beta");

  const at = new Date(2026, 0, 1, 10, 5, 0);
  expect(await s.run(at)).toBe(1);
  expect(log).toEqual(["a"]);

  const onHour = new Date(2026, 0, 1, 10, 0, 0);
  log.length = 0;
  expect(await s.run(onHour)).toBe(2);
  expect(log).toEqual(["a", "b"]);
});

test("schedule.job dispatches via runner", async () => {
  setScheduleMutexStore(undefined);
  const dispatched: string[] = [];
  setScheduleJobRunner(async (job) => {
    dispatched.push(job.name);
    await job.handle();
  });

  const s = new Schedule();
  setSchedule(s);
  s.job({
    name: "PingJob",
    handle() {
      dispatched.push("handled");
    },
  }).everyMinute();

  expect(await s.run(new Date(2026, 0, 1, 10, 5, 0))).toBe(1);
  expect(dispatched).toEqual(["PingJob", "handled"]);
});

test("schedule.command runs via runner", async () => {
  setScheduleMutexStore(undefined);
  const ran: string[] = [];
  setScheduleCommandRunner(async (command, args) => {
    ran.push(`${command} ${args.join(" ")}`.trim());
  });

  const s = new Schedule();
  setSchedule(s);
  s.command("queue:status default").everyMinute();

  expect(await s.run(new Date(2026, 0, 1, 10, 5, 0))).toBe(1);
  expect(ran).toEqual(["queue:status default"]);
});

test("withoutOverlapping uses file mutex", async () => {
  setScheduleMutexStore(undefined);
  const dir = await mkdtemp(join(tmpdir(), "bunyad-sched-"));
  const path = join(dir, "test.lock");

  expect(await acquireMutex(path, 60_000)).toBe(true);
  expect(await acquireMutex(path, 60_000)).toBe(false);
  await releaseMutex(path);
  expect(await acquireMutex(path, 60_000)).toBe(true);
  await releaseMutex(path);

  const s = new Schedule({ mutexPath: dir });
  let runs = 0;
  const event = s
    .call(async () => {
      runs += 1;
      await Bun.sleep(50);
    })
    .everyMinute()
    .name("slow")
    .withoutOverlapping(1);

  const lockPath = join(
    dir,
    (await import("../src/mutex.ts")).mutexFilename("slow"),
  );
  expect(await acquireMutex(lockPath, 60_000)).toBe(true);
  await event.run();
  expect(runs).toBe(0);
  await releaseMutex(lockPath);
  await event.run();
  expect(runs).toBe(1);
});

test("onOneServer uses cache mutex store", async () => {
  const keys = new Map<string, number>();
  setScheduleMutexStore({
    async add(key, seconds) {
      if (keys.has(key)) return false;
      keys.set(key, seconds);
      return true;
    },
    async forget(key) {
      keys.delete(key);
    },
  });

  const s = new Schedule();
  let runs = 0;
  const event = s
    .call(() => {
      runs += 1;
    })
    .everyMinute()
    .name("once")
    .onOneServer();

  const now = new Date(2026, 0, 1, 10, 5, 0);
  await event.run(now);
  await event.run(now);
  expect(runs).toBe(1);
  expect(keys.size).toBe(1);

  setScheduleMutexStore(undefined);
});

test("schedule.run skips duplicate tick same minute", async () => {
  setScheduleMutexStore(undefined);
  const s = new Schedule();
  let runs = 0;
  s.call(() => {
    runs += 1;
  }).everyMinute();

  const now = new Date(2026, 0, 1, 10, 5, 0);
  expect(await s.run(now)).toBe(1);
  expect(await s.run(now)).toBe(0);
  expect(runs).toBe(1);
});

test("schedule.work once runs a tick", async () => {
  setScheduleMutexStore(undefined);
  const s = new Schedule();
  let ticks = 0;
  s.call(() => {
    ticks += 1;
  }).cron("* * * * *");

  const total = await s.work({ once: true });
  expect(total).toBe(1);
  expect(ticks).toBe(1);
});

test("weekly monthly environments when skip sendOutputTo", async () => {
  setScheduleMutexStore(undefined);
  const dir = await mkdtemp(join(tmpdir(), "bunyad-sched-out-"));
  const out = join(dir, "report.txt");

  const sundayMidnight = new Date(2026, 0, 4, 0, 0, 0); // Sunday
  const firstOfMonth = new Date(2026, 1, 1, 0, 0, 0); // Sunday Feb 1

  expect(
    cronMatches("0 0 * * 0", sundayMidnight),
  ).toBe(true);
  expect(cronMatches("0 0 1 * *", firstOfMonth)).toBe(true);

  const s = new Schedule();
  let weeklyRuns = 0;
  s.call(() => {
    weeklyRuns += 1;
  })
    .weekly()
    .name("weekly");

  expect(s.events()[0]!.expression).toBe("0 0 * * 0");
  expect(s.events()[0]!.isDue(sundayMidnight)).toBe(true);
  expect(s.events()[0]!.isDue(new Date(2026, 0, 5, 0, 0, 0))).toBe(false);

  s.clear();
  s.call(() => "ok")
    .monthlyOn(1, "0:0")
    .name("monthly");
  expect(s.events()[0]!.expression).toBe("0 0 1 * *");

  s.clear();
  const prev = process.env.APP_ENV;
  process.env.APP_ENV = "testing";
  let envRuns = 0;
  const envEvent = s
    .call(() => {
      envRuns += 1;
    })
    .everyMinute()
    .environments("production");
  expect(envEvent.isDue(new Date(2026, 0, 1, 10, 5, 0))).toBe(false);
  process.env.APP_ENV = "production";
  expect(envEvent.isDue(new Date(2026, 0, 1, 10, 5, 0))).toBe(true);
  process.env.APP_ENV = prev;

  s.clear();
  let gated = 0;
  const gatedEvent = s
    .call(() => {
      gated += 1;
    })
    .everyMinute()
    .when(() => true)
    .skip(() => true);
  await gatedEvent.run(new Date(2026, 0, 1, 10, 5, 0));
  expect(gated).toBe(0);

  s.clear();
  setScheduleCommandRunner(async () => "hello-output");
  s.command("report:generate")
    .everyMinute()
    .sendOutputTo(out);
  await s.run(new Date(2026, 0, 1, 10, 5, 0));
  expect(await Bun.file(out).text()).toBe("hello-output\n");
});

test("frequencies days between before after group dueEvents", async () => {
  setScheduleMutexStore(undefined);
  const s = new Schedule();

  expect(s.call(() => {}).fridays().at("17:00").getExpression()).toBe(
    "0 17 * * 5",
  );
  expect(s.call(() => {}).twiceDaily(1, 13).getExpression()).toBe(
    "0 1,13 * * *",
  );
  expect(s.call(() => {}).quarterly().getExpression()).toBe("0 0 1 1-12/3 *");
  expect(s.call(() => {}).everyThreeMinutes().getExpression()).toBe(
    "*/3 * * * *",
  );
  expect(s.call(() => {}).hourlyAt(15).getExpression()).toBe("15 * * * *");
  expect(s.call(() => {}).everySecond().isRepeatable()).toBe(true);

  s.clear();
  const hooks: string[] = [];
  const event = s
    .call(() => {
      hooks.push("run");
      return "out";
    })
    .everyMinute()
    .before(() => {
      hooks.push("before");
    })
    .after(() => {
      hooks.push("after");
    })
    .onSuccess(() => {
      hooks.push("success");
    })
    .between("00:00", "23:59");

  await event.run(new Date(2026, 0, 1, 10, 5, 0));
  expect(hooks).toEqual(["before", "run", "success", "after"]);

  s.clear();
  s.group(() => {
    s.call(() => {}).name("g1");
    s.call(() => {}).name("g2");
  }).daily().environments("production");

  expect(s.events()).toHaveLength(2);
  expect(s.events()[0]!.expression).toBe("0 0 * * *");
  expect(s.events()[0]!.runsInEnvironment("production")).toBe(true);
  expect(s.events()).toHaveLength(2);
});

test("schedule.exec runs shell and returns stdout", async () => {
  setScheduleMutexStore(undefined);
  const s = new Schedule();
  const event = s.exec("printf 'hello-exec'").everyMinute().name("exec-test");
  const at = new Date(2026, 0, 1, 10, 5, 0);
  await event.run(at);
  // Output captured via return value path — verify via sendOutputTo
  const dir = await mkdtemp(join(tmpdir(), "bunyad-sched-exec-"));
  const out = join(dir, "out.txt");
  s.clear();
  s.exec("printf 'hello-exec'")
    .everyMinute()
    .sendOutputTo(out);
  await s.run(at);
  expect(await Bun.file(out).text()).toBe("hello-exec\n");
});

test("withoutOverlapping prefers Cache.add mutex store", async () => {
  const keys = new Map<string, number>();
  setScheduleMutexStore({
    async add(key, seconds) {
      if (keys.has(key)) return false;
      keys.set(key, seconds);
      return true;
    },
    async forget(key) {
      keys.delete(key);
    },
  });

  const s = new Schedule();
  let runs = 0;
  const event = s
    .call(async () => {
      runs += 1;
      // Hold the lock while a second run attempts acquire
      await Bun.sleep(30);
    })
    .everyMinute()
    .name("cache-overlap")
    .withoutOverlapping(1);

  const now = new Date(2026, 0, 1, 10, 5, 0);
  const first = event.run(now);
  await Bun.sleep(5);
  // Second concurrent attempt should fail Cache.add
  await event.run(now);
  await first;
  expect(runs).toBe(1);
  expect([...keys.keys()].some((k) => k.startsWith("schedule:overlap:"))).toBe(
    false,
  ); // released after run

  // Sequential after release works
  await event.run(now);
  expect(runs).toBe(2);

  setScheduleMutexStore(undefined);
});

test("appendOutputTo emailOutput emailOutputOnFailure", async () => {
  setScheduleMutexStore(undefined);
  const dir = await mkdtemp(join(tmpdir(), "bunyad-sched-append-"));
  const out = join(dir, "log.txt");

  const mailed: Array<{ to: string[]; subject: string; body: string }> = [];
  setScheduleMailSender(async (addresses, subject, body) => {
    mailed.push({ to: addresses, subject, body });
  });

  const s = new Schedule();
  setScheduleCommandRunner(async () => "line-1");
  const ev = s
    .command("report:once")
    .everyMinute()
    .appendOutputTo(out)
    .emailOutput("ops@example.com")
    .name("report");

  await ev.run(new Date(2026, 0, 1, 10, 5, 0));
  expect(await Bun.file(out).text()).toBe("line-1\n");
  expect(mailed).toHaveLength(1);
  expect(mailed[0]!.to).toEqual(["ops@example.com"]);
  expect(mailed[0]!.subject).toContain("report");
  expect(mailed[0]!.body).toContain("line-1");

  setScheduleCommandRunner(async () => "line-2");
  s.clear();
  mailed.length = 0;
  const ev2 = s
    .command("report:twice")
    .everyMinute()
    .appendOutputTo(out)
    .emailWrittenOutputTo("ops@example.com");
  await ev2.run(new Date(2026, 0, 1, 10, 6, 0));
  expect(await Bun.file(out).text()).toBe("line-1\nline-2\n");
  expect(mailed).toHaveLength(1);

  // Failure emails
  s.clear();
  mailed.length = 0;
  const failEv = s
    .call(async () => {
      throw new Error("boom");
    })
    .everyMinute()
    .emailOutputOnFailure("alert@example.com")
    .name("failing");
  await expect(failEv.run(new Date(2026, 0, 1, 10, 7, 0))).rejects.toThrow(
    "boom",
  );
  expect(mailed).toHaveLength(1);
  expect(mailed[0]!.to).toEqual(["alert@example.com"]);
  expect(mailed[0]!.subject).toContain("Failed");

  // Empty success output skips email
  s.clear();
  mailed.length = 0;
  const emptyEv = s
    .call(() => {})
    .everyMinute()
    .emailOutput("ops@example.com");
  await emptyEv.run(new Date(2026, 0, 1, 10, 8, 0));
  expect(mailed).toHaveLength(0);

  setScheduleMailSender(undefined);
});

test("dailyAt weeklyOn yearlyOn frequency expressions", async () => {
  const s = new Schedule();
  expect(s.call(() => {}).dailyAt("13:30").getExpression()).toBe("30 13 * * *");
  expect(s.call(() => {}).weeklyOn(1, "8:00").getExpression()).toBe(
    "0 8 * * 1",
  );
  expect(s.call(() => {}).yearlyOn(6, 15, "9:00").getExpression()).toBe(
    "0 9 15 6 *",
  );
  expect(s.call(() => {}).daysOfMonth(1, 15).getExpression()).toBe(
    "* * 1,15 * *",
  );
});

test("wrapScheduledRuns wraps each task's callback, outermost first, and can be removed", async () => {
  setScheduleMutexStore(undefined);
  const s = new Schedule();
  setSchedule(s);
  const log: string[] = [];

  schedule()
    .call(async () => {
      log.push("task");
      return undefined;
    })
    .everyMinute()
    .name("alpha");

  const stopA = wrapScheduledRuns(async (info, run) => {
    log.push(`A+ ${info.name} ${info.expression}`);
    try {
      return await run();
    } finally {
      log.push("A-");
    }
  });
  const stopB = wrapScheduledRuns(async (_info, run) => {
    log.push("B+");
    const result = await run();
    log.push("B-");
    return result;
  });

  const at = new Date(2026, 0, 1, 10, 5, 0);
  await s.run(at);
  expect(log).toEqual(["A+ alpha * * * * *", "B+", "task", "B-", "A-"]);

  stopA();
  stopB();
  log.length = 0;
  await s.run(new Date(2026, 0, 1, 10, 6, 0)); // a new minute: a task runs once per minute
  expect(log).toEqual(["task"]);
});

test("a wrapper sees the failure of a task, which still propagates", async () => {
  setScheduleMutexStore(undefined);
  const s = new Schedule();
  setSchedule(s);
  schedule()
    .call(() => {
      throw new Error("kaput");
    })
    .everyMinute()
    .name("boom");

  const seen: string[] = [];
  const stop = wrapScheduledRuns(async (info, run) => {
    try {
      return await run();
    } catch (error) {
      seen.push(`${info.name}: ${(error as Error).message}`);
      throw error;
    }
  });
  await expect(s.run(new Date(2026, 0, 1, 10, 5, 0))).rejects.toThrow("kaput");
  stop();
  expect(seen).toEqual(["boom: kaput"]);
});
