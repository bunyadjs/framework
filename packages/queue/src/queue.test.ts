import { expect, test } from "bun:test";
import {
  Job,
  MemoryQueueDriver,
  QueueManager,
  Queue,
  dispatch,
  setQueue,
  WithoutOverlapping,
  RateLimited,
  Limit,
  Bus,
  type ShouldQueue,
  setBatchRepository,
  MemoryBatchRepository,
  MemoryFailedJobRepository,
} from "../src/index.ts";
import { CacheRepository, setCache, MemoryCacheStore } from "@bunyad/cache";
import { RateLimiter, setRateLimiter } from "@bunyad/http";

class HelloJob extends Job {
  constructor(readonly name: string) {
    super();
  }

  handle(): void {
    log.push(this.name);
  }
}

const log: string[] = [];

test("sync driver runs immediately", async () => {
  log.length = 0;
  const q = new QueueManager({ connection: "sync" });
  setQueue(q);
  await dispatch(new HelloJob("Ada"));
  expect(log).toEqual(["Ada"]);
});

test("memory driver waits for work()", async () => {
  log.length = 0;
  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  await dispatch(new HelloJob("Bob"));
  expect(log).toEqual([]);
  expect(await q.size()).toBe(1);

  expect(await q.work()).toBe(1);
  expect(log).toEqual(["Bob"]);
  expect(await q.size()).toBe(0);
});

test("named push + register", async () => {
  const seen: unknown[] = [];
  const q = new QueueManager({ connection: "memory" });
  q.register("ping", (data) => {
    seen.push(data);
  });
  await q.push("ping", { ok: true });
  await q.work();
  expect(seen).toEqual([{ ok: true }]);
});

test("database driver persists and pops jobs", async () => {
  log.length = 0;
  const { connectSqlite } = await import("@bunyad/database");
  const { DatabaseQueueDriver } = await import("../src/database-driver.ts");
  const db = connectSqlite({ path: ":memory:" });
  await db.exec(`CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue TEXT NOT NULL,
    payload TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    reserved_at INTEGER,
    available_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`);

  const q = new QueueManager({
    driver: new DatabaseQueueDriver({ connection: db }),
  });
  setQueue(q);

  await dispatch(new HelloJob("Carla"));
  expect(log).toEqual([]);
  expect(await q.size()).toBe(1);
  expect(await q.work()).toBe(1);
  expect(log).toEqual(["Carla"]);
  await db.close();
});

test("daemon once drains queue", async () => {
  log.length = 0;
  const q = new QueueManager({ connection: "memory" });
  setQueue(q);
  await dispatch(new HelloJob("A"));
  await dispatch(new HelloJob("B"));
  const total = await q.daemon({ once: true, sleep: 1 });
  expect(total).toBe(2);
  expect(log).toEqual(["A", "B"]);
});

test("retries then records failed job", async () => {
  class FlakyJob extends Job {
    tries = 3;
    handle(): void {
      throws += 1;
      throw new Error("boom");
    }
  }

  let throws = 0;
  const { MemoryFailedJobRepository } = await import("../src/memory-failed.ts");
  const failed = new MemoryFailedJobRepository();
  const q = new QueueManager({
    connection: "memory",
    failed,
  });
  setQueue(q);

  await dispatch(new FlakyJob());
  await q.daemon({ once: true, sleep: 1 });

  expect(throws).toBe(3);
  const all = await failed.all();
  expect(all).toHaveLength(1);
  expect(all[0]!.exception).toContain("boom");

  expect(await q.retry(all[0]!.id)).toBe(true);
  expect(await failed.all()).toHaveLength(0);
  expect(await q.size()).toBe(1);
});

test("Queue.fake records jobs without running them", async () => {
  log.length = 0;
  setQueue(new QueueManager({ connection: "sync" }));
  const fake = Queue.fake();

  await dispatch(new HelloJob("Ada"));
  expect(log).toEqual([]);

  Queue.assertPushed(HelloJob);
  Queue.assertPushed(HelloJob, (job) => {
    return (job.data as HelloJob).name === "Ada";
  });
  Queue.assertPushedTimes(HelloJob, 1);
  Queue.assertNotPushed("MissingJob");

  fake.restore();
  await dispatch(new HelloJob("Bob"));
  expect(log).toEqual(["Bob"]);
});

test("Queue pause hooks and Batch hasFailures delete", async () => {
  const { Bus, setBatchRepository, MemoryBatchRepository } =
    await import("../src/index.ts");
  setBatchRepository(new MemoryBatchRepository());
  setQueue(new QueueManager({ connection: "memory" }));

  const hooks: string[] = [];
  Queue.before(() => {
    hooks.push("before");
  });
  Queue.after(() => {
    hooks.push("after");
  });

  Queue.pause("default");
  expect(Queue.isPaused()).toBe(true);
  await dispatch(new HelloJob("paused"));
  expect(await Queue.work("default", 1)).toBe(0);
  Queue.resume();
  expect(await Queue.work("default", 1)).toBe(1);
  expect(hooks).toContain("before");
  expect(hooks).toContain("after");

  const batch = await Bus.batch([]).name("empty").dispatch();
  expect(batch.hasFailures()).toBe(false);
  expect(batch.processedJobs()).toBe(0);
  await batch.delete();
  expect(await Bus.findBatch(batch.id)).toBeNull();

  expect(Queue.getDefaultDriver()).toBe("sync");
  Queue.setDefaultDriver("memory");
  expect(Queue.getName()).toBe("memory");
  Queue.setDefaultDriver("sync");
});

test("SerializesModels reloads models when the job runs", async () => {
  const {
    SerializesModels,
    clearSerializableModels,
    registerSerializableModel,
  } = await import("../src/serializes-models.ts");
  const { connectSqlite, schemaFor } = await import("@bunyad/database");
  const { Model } = await import("@bunyad/orm");

  clearSerializableModels();

  class Person extends Model {
    declare name: string;
    static table = "people";
  }

  @SerializesModels()
  class GreetPerson extends Job {
    seenName: string | undefined;
    constructor(public person: Person) {
      super();
    }
    async handle() {
      this.seenName = this.person.name;
      greetLog.push(this.person.name);
    }
  }

  const greetLog: string[] = [];
  const connection = connectSqlite();
  Model.setConnection(connection);
  await schemaFor(connection).create("people", (table) => {
    table.id();
    table.string("name");
    table.timestamps();
  });

  const person = (await Person.create({ name: "Ada" })) as Person;
  registerSerializableModel(Person);

  const q = new QueueManager({
    driver: new MemoryQueueDriver(),
  });
  // Force serialization path like database/redis drivers.
  (q.driver as { serializes?: boolean }).serializes = true;
  setQueue(q);

  await dispatch(new GreetPerson(person));
  expect(greetLog).toEqual([]);
  expect(await q.work()).toBe(1);
  expect(greetLog).toEqual(["Ada"]);

  clearSerializableModels();
  await connection.close();
});

test("WithoutOverlapping blocks concurrent runs and releases lock", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  const ran: string[] = [];
  let releaseCalls = 0;

  class OverlapJob extends Job {
    tries = 5;
    constructor(readonly label: string) {
      super();
    }
    middleware() {
      return [new WithoutOverlapping("invoice-1").releaseAfter(1).expireAfter(60)];
    }
    handle(): void {
      ran.push(this.label);
    }
  }

  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  // Hold the lock as if another worker owns it.
  expect(await (await import("@bunyad/cache")).cache().add(
    "bunyad-queue-overlap:invoice-1",
    "other-owner",
    60,
  )).toBe(true);

  await dispatch(new OverlapJob("blocked"));
  expect(await q.work()).toBe(1);
  expect(ran).toEqual([]); // middleware released without handle
  expect(await q.size()).toBe(1); // re-queued

  // Clear lock — next work should run.
  await (await import("@bunyad/cache")).cache().forget("bunyad-queue-overlap:invoice-1");
  // Make available now (release delay may still apply — push with delay 1s).
  // Force pop by waiting: MemoryQueueDriver respects availableAt.
  await Bun.sleep(1100);
  expect(await q.work()).toBe(1);
  expect(ran).toEqual(["blocked"]);

  // Successful run releases lock so a second job can run.
  await dispatch(new OverlapJob("second"));
  expect(await q.work()).toBe(1);
  expect(ran).toEqual(["blocked", "second"]);
  void releaseCalls;
});

test("WithoutOverlapping dontRelease drops overlapping job", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  const ran: string[] = [];

  class DropJob extends Job {
    middleware() {
      return [new WithoutOverlapping("x").dontRelease()];
    }
    handle(): void {
      ran.push("ran");
    }
  }

  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  await (await import("@bunyad/cache")).cache().add(
    "bunyad-queue-overlap:x",
    "held",
    60,
  );
  await dispatch(new DropJob());
  expect(await q.work()).toBe(1);
  expect(ran).toEqual([]);
  expect(await q.size()).toBe(0);
});

test("RateLimited releases when over limit", async () => {
  const limiter = new RateLimiter();
  limiter.for("backups", () => Limit.perMinute(1).by("site-1"));
  setRateLimiter(limiter);

  const ran: number[] = [];
  class BackupJob extends Job {
    tries = 5;
    middleware() {
      return [new RateLimited("backups").using(() => Limit.perMinute(1).by("site-1"))];
    }
    handle(): void {
      ran.push(1);
    }
  }

  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  await dispatch(new BackupJob());
  expect(await q.work()).toBe(1);
  expect(ran).toEqual([1]);

  await dispatch(new BackupJob());
  expect(await q.work()).toBe(1);
  expect(ran).toEqual([1]); // second released
  expect(await q.size()).toBe(1);
});

test("Bus.dispatchSync runs job middleware", async () => {
  const { cache } = await import("@bunyad/cache");
  setCache(new CacheRepository(new MemoryCacheStore()));
  let ran = 0;
  class SyncMwJob extends Job {
    middleware() {
      return [new WithoutOverlapping("sync-mw")];
    }
    handle(): void {
      ran += 1;
    }
  }
  await Bus.dispatchSync(new SyncMwJob());
  expect(ran).toBe(1);

  expect(await cache().add("bunyad-queue-overlap:sync-mw", "held", 60)).toBe(
    true,
  );
  await Bus.dispatchSync(new SyncMwJob());
  expect(ran).toBe(1); // blocked by lock
});

test("ShouldBeUnique drops duplicate dispatch", async () => {
  const { CacheRepository, MemoryCacheStore, setCache } = await import("@bunyad/cache");
  setCache(new CacheRepository(new MemoryCacheStore()));
  const ran: string[] = [];

  class UniqueJob extends Job {
    uniqueFor = 60;
    constructor(readonly key: string) {
      super();
    }
    uniqueId() {
      return this.key;
    }
    handle(): void {
      ran.push(this.key);
    }
  }

  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  const id1 = await q.dispatch(new UniqueJob("invoice-1"));
  const id2 = await q.dispatch(new UniqueJob("invoice-1"));
  expect(id1.length).toBeGreaterThan(0);
  expect(id2).toBe("");
  expect(await q.size()).toBe(1);
  expect(await q.work()).toBe(1);
  expect(ran).toEqual(["invoice-1"]);
});

test("ShouldBeUniqueUntilProcessing releases lock when work starts", async () => {
  const { CacheRepository, MemoryCacheStore, setCache, cache } = await import(
    "@bunyad/cache"
  );
  setCache(new CacheRepository(new MemoryCacheStore()));
  const ran: number[] = [];

  class UniqueUntilJob extends Job {
    uniqueFor = 60;
    shouldBeUniqueUntilProcessing = true as const;
    uniqueId() {
      return "once";
    }
    handle(): void {
      ran.push(1);
    }
  }

  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  await q.dispatch(new UniqueUntilJob());
  expect(await q.work()).toBe(1);
  expect(ran).toEqual([1]);
  // Lock released — another dispatch succeeds.
  const id = await q.dispatch(new UniqueUntilJob());
  expect(id.length).toBeGreaterThan(0);
});

test("PendingDispatch afterCommit runs after DB transaction", async () => {
  const { connectSqlite } = await import("@bunyad/database");
  const connection = connectSqlite();
  const ran: string[] = [];

  class AfterCommitJob extends Job {
    handle(): void {
      ran.push("job");
    }
  }

  const q = new QueueManager({ connection: "sync" });
  setQueue(q);

  await connection.transaction(async () => {
    void dispatch(new AfterCommitJob()).afterCommit();
    expect(ran).toEqual([]); // still in transaction
  });
  await Bun.sleep(20);
  expect(ran).toEqual(["job"]);

  // Without a transaction, afterCommit dispatches immediately (next tick).
  ran.length = 0;
  await dispatch(new AfterCommitJob()).afterCommit();
  await Bun.sleep(20);
  expect(ran).toEqual(["job"]);

  await connection.close();
});

test("Queue.route sets default queue when job has no explicit onQueue", async () => {
  Queue.clearRoutes();
  class ProcessPodcast extends Job {
    handle() {}
  }
  Queue.route(ProcessPodcast, { queue: "podcasts", connection: "redis" });

  const fakeBase = new QueueManager({ connection: "memory" });
  setQueue(fakeBase);
  const fake = Queue.fake();

  await dispatch(new ProcessPodcast());
  fake.assertPushed(ProcessPodcast, (j) => j.queue === "podcasts");

  const explicit = new ProcessPodcast();
  await dispatch(explicit).onQueue("priority");
  fake.assertPushed(ProcessPodcast, (j) => j.queue === "priority");

  Queue.clearRoutes();
  fake.restore();
});

test("Queue.route matches parent / marker class via instanceof", async () => {
  Queue.clearRoutes();
  class RequiresVideo extends Job {
    handle() {}
  }
  class ProcessVideo extends RequiresVideo {
    handle() {}
  }
  Queue.route(RequiresVideo, { queue: "video" });

  setQueue(new QueueManager({ connection: "memory" }));
  const fake = Queue.fake();
  await dispatch(new ProcessVideo());
  fake.assertPushed(ProcessVideo, (j) => j.queue === "video");
  Queue.clearRoutes();
  fake.restore();
});

test("Queue.route class-specific wins over parent marker", async () => {
  Queue.clearRoutes();
  class RequiresVideo extends Job {
    handle() {}
  }
  class ProcessVideo extends RequiresVideo {
    handle() {}
  }
  Queue.route(RequiresVideo, { queue: "video" });
  Queue.route(ProcessVideo, { queue: "video-priority" });

  setQueue(new QueueManager({ connection: "memory" }));
  const fake = Queue.fake();
  await dispatch(new ProcessVideo());
  fake.assertPushed(ProcessVideo, (j) => j.queue === "video-priority");
  Queue.clearRoutes();
  fake.restore();
});

test("Queue.route array map and positional queue/connection", async () => {
  Queue.clearRoutes();
  class ProcessPodcast extends Job {
    handle() {}
  }
  class ProcessVideo extends Job {
    handle() {}
  }
  Queue.route([
    [ProcessPodcast, { queue: "podcasts", connection: "redis" }],
    [ProcessVideo, "videos"],
  ]);
  Queue.route(ProcessPodcast, "podcasts", "redis"); // idempotent refresh

  setQueue(new QueueManager({ connection: "memory" }));
  const fake = Queue.fake();
  const job = new ProcessPodcast();
  await dispatch(job);
  expect(job.queue).toBe("podcasts");
  expect(job.connection).toBe("redis");
  fake.assertPushed(ProcessPodcast, (j) => j.queue === "podcasts");

  const video = new ProcessVideo();
  await dispatch(video);
  expect(video.queue).toBe("videos");
  Queue.clearRoutes();
  fake.restore();
});

test("Job class queue property beats Queue.route", async () => {
  Queue.clearRoutes();
  class ProcessEmail extends Job {
    queue = "emails";
    handle() {}
  }
  Queue.route(ProcessEmail, { queue: "routed" });
  setQueue(new QueueManager({ connection: "memory" }));
  const fake = Queue.fake();
  await dispatch(new ProcessEmail());
  fake.assertPushed(ProcessEmail, (j) => j.queue === "emails");
  Queue.clearRoutes();
  fake.restore();
});


test("Job implements ShouldQueue marker", () => {
  const job = new HelloJob("x");
  const marker: ShouldQueue = job;
  expect(marker).toBe(job);
});

test("delay / later / onQueue defer until availableAt", async () => {
  log.length = 0;
  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  await dispatch(new HelloJob("delayed")).delay(2).onQueue("mail");
  expect(await q.size("mail")).toBe(1);
  expect(await q.work("mail")).toBe(0); // not available yet
  expect(log).toEqual([]);

  await Queue.later(0, Object.assign(new HelloJob("later"), { queue: "mail", delay: 0 }));
  // Force availableAt now via later(0)
  expect(await q.work("mail")).toBe(1);
  expect(log).toEqual(["later"]);

  // Advance delayed job by sleeping past availableAt
  await Bun.sleep(2100);
  expect(await q.work("mail")).toBe(1);
  expect(log).toEqual(["later", "delayed"]);
});

test("Bus.chain runs jobs in order and catch on failure", async () => {
  log.length = 0;
  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);

  class Step extends Job {
    constructor(readonly label: string) {
      super();
    }
    handle(): void {
      log.push(this.label);
    }
  }
  class Boom extends Job {
    tries = 1;
    handle(): void {
      throw new Error("chain-boom");
    }
  }

  await Bus.chain([new Step("a"), new Step("b"), new Step("c")]).dispatch();
  await q.daemon({ once: true, sleep: 1 });
  expect(log).toEqual(["a", "b", "c"]);

  log.length = 0;
  const errors: string[] = [];
  const failed = new MemoryFailedJobRepository();
  const qFail = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
    failed,
  });
  setQueue(qFail);
  await Bus.chain([new Step("x"), new Boom(), new Step("y")])
    .catch((e) => {
      errors.push(e.message);
    })
    .dispatch();
  await qFail.daemon({ once: true, sleep: 1 });
  expect(log).toEqual(["x"]);
  expect(errors).toEqual(["chain-boom"]);
  expect(await failed.all()).toHaveLength(1);
});

test("dispatch().chain appends after first job", async () => {
  log.length = 0;
  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);
  class Step extends Job {
    constructor(readonly label: string) {
      super();
    }
    handle(): void {
      log.push(this.label);
    }
  }
  await dispatch(new Step("first")).chain([new Step("second")]);
  await q.daemon({ once: true, sleep: 1 });
  expect(log).toEqual(["first", "second"]);
});

test("Bus.batch then/catch/finally/allowFailures", async () => {
  setBatchRepository(new MemoryBatchRepository());
  const failed = new MemoryFailedJobRepository();
  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
    failed,
  });
  setQueue(q);

  const events: string[] = [];
  class OkJob extends Job {
    handle(): void {
      events.push("ok");
    }
  }
  class FailJob extends Job {
    tries = 1;
    handle(): void {
      throw new Error("batch-fail");
    }
  }

  // Success path
  const okBatch = await Bus.batch([new OkJob(), new OkJob()])
    .name("ok")
    .then(() => {
      events.push("then");
    })
    .finally(() => {
      events.push("finally");
    })
    .dispatch();
  await q.daemon({ once: true, sleep: 1 });
  const freshOk = await okBatch.fresh();
  expect(freshOk?.successful()).toBe(true);
  expect(events).toContain("then");
  expect(events).toContain("finally");

  // Failure cancels remaining without allowFailures
  events.length = 0;
  setBatchRepository(new MemoryBatchRepository());
  await Bus.batch([new FailJob(), new OkJob()])
    .catch(() => {
      events.push("catch");
    })
    .finally(() => {
      events.push("finally");
    })
    .dispatch();
  await q.daemon({ once: true, sleep: 1 });
  expect(events).toContain("catch");
  expect(events).toContain("finally");
  expect(events).not.toContain("ok"); // second skipped after cancel

  // allowFailures keeps going
  events.length = 0;
  setBatchRepository(new MemoryBatchRepository());
  const batch = await Bus.batch([new FailJob(), new OkJob()])
    .allowFailures()
    .then(() => {
      events.push("then");
    })
    .finally(() => {
      events.push("finally");
    })
    .dispatch();
  await q.daemon({ once: true, sleep: 1 });
  expect(events).toContain("ok");
  expect(events).toContain("finally");
  const fresh = await batch.fresh();
  expect(fresh?.hasFailures()).toBe(true);
  expect(fresh?.finished()).toBe(true);
  expect(events).not.toContain("then"); // failures present → then skipped
});

test("ShouldBeUnique releases lock after successful finish", async () => {
  setCache(new CacheRepository(new MemoryCacheStore()));
  const ran: string[] = [];
  class UniqueJob extends Job {
    uniqueFor = 3600;
    constructor(readonly key: string) {
      super();
    }
    uniqueId() {
      return this.key;
    }
    handle(): void {
      ran.push(this.key);
    }
  }
  const q = new QueueManager({
    connection: "memory",
    driver: new MemoryQueueDriver(),
  });
  setQueue(q);
  await q.dispatch(new UniqueJob("inv"));
  expect(await q.work()).toBe(1);
  expect(ran).toEqual(["inv"]);
  // After finish, another dispatch with same uniqueId succeeds.
  const id = await q.dispatch(new UniqueJob("inv"));
  expect(id.length).toBeGreaterThan(0);
  expect(await q.work()).toBe(1);
  expect(ran).toEqual(["inv", "inv"]);
});

test("Job.afterCommit property defers until transaction commits", async () => {
  const { connectSqlite } = await import("@bunyad/database");
  const connection = connectSqlite();
  const ran: string[] = [];
  class PropAfterCommit extends Job {
    afterCommit = true;
    handle(): void {
      ran.push("job");
    }
  }
  setQueue(new QueueManager({ connection: "sync" }));
  await connection.transaction(async () => {
    void dispatch(new PropAfterCommit());
    expect(ran).toEqual([]);
  });
  await Bun.sleep(20);
  expect(ran).toEqual(["job"]);
  await connection.close();
});

test("RedisQueueDriver push/pop with delayed promotion", async () => {
  const { RedisQueueDriver } = await import("../src/redis-driver.ts");
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, Array<{ score: number; member: string }>>();
  const client = {
    async lpush(key: string, raw: string) {
      const list = lists.get(key) ?? [];
      list.unshift(raw);
      lists.set(key, list);
    },
    async rpop(key: string) {
      const list = lists.get(key) ?? [];
      return list.pop();
    },
    async llen(key: string) {
      return lists.get(key)?.length ?? 0;
    },
    async zadd(key: string, score: number, member: string) {
      const set = zsets.get(key) ?? [];
      set.push({ score, member });
      zsets.set(key, set);
    },
    async zrangebyscore(key: string, min: number, max: number) {
      const set = zsets.get(key) ?? [];
      return set.filter((e) => e.score >= min && e.score <= max).map((e) => e.member);
    },
    async zrem(key: string, member: string) {
      const set = zsets.get(key) ?? [];
      zsets.set(
        key,
        set.filter((e) => e.member !== member),
      );
    },
    async zcard(key: string) {
      return zsets.get(key)?.length ?? 0;
    },
    close() {},
  };
  const driver = new RedisQueueDriver({ client: client as never });
  const now = Math.floor(Date.now() / 1000);
  await driver.push("default", {
    id: "1",
    name: "Ready",
    data: {},
    attempts: 0,
  });
  await driver.push("default", {
    id: "2",
    name: "Later",
    data: {},
    attempts: 0,
    availableAt: now + 60,
  });
  expect(await driver.size("default")).toBe(2);
  const ready = await driver.pop("default");
  expect(ready?.name).toBe("Ready");
  expect(await driver.pop("default")).toBeUndefined(); // delayed not ready
  // Promote: set score to past
  const delayedKey = "bunyad:queues:default:delayed";
  const entry = zsets.get(delayedKey)![0]!;
  entry.score = now - 1;
  const promoted = await driver.pop("default");
  expect(promoted?.name).toBe("Later");
  driver.close();
});

test("daemon stops when AbortSignal aborts", async () => {
  const q = new QueueManager({ connection: "memory" });
  setQueue(q);
  const ac = new AbortController();
  const run = q.daemon({ sleep: 20, signal: ac.signal });
  await Bun.sleep(30);
  ac.abort();
  const total = await run;
  expect(total).toBe(0);
});

test("worker applies backoff between retries", async () => {
  class BackoffJob extends Job {
    tries = 3;
    backoff = 30;
    handle(): void {
      throws += 1;
      throw new Error("retry me");
    }
  }

  let throws = 0;
  const { MemoryFailedJobRepository } = await import("../src/memory-failed.ts");
  const failed = new MemoryFailedJobRepository();
  const q = new QueueManager({ connection: "memory", failed });
  setQueue(q);

  await dispatch(new BackoffJob());
  expect(await q.work("default", 1)).toBe(1);
  expect(throws).toBe(1);
  // Delayed retry — not available yet
  expect(await q.work("default", 1)).toBe(0);
  expect(await q.size()).toBe(1);
});

test("worker stops retrying after retryUntil", async () => {
  class ExpiringJob extends Job {
    tries = 10;
    retryUntil(): number {
      return Math.floor(Date.now() / 1000) - 1;
    }
    handle(): void {
      throws += 1;
      throw new Error("late");
    }
  }

  let throws = 0;
  const { MemoryFailedJobRepository } = await import("../src/memory-failed.ts");
  const failed = new MemoryFailedJobRepository();
  const q = new QueueManager({ connection: "memory", failed });
  setQueue(q);

  await dispatch(new ExpiringJob());
  await q.daemon({ once: true, sleep: 1 });

  expect(throws).toBe(1);
  expect(await failed.all()).toHaveLength(1);
});

test("worker fails after maxExceptions", async () => {
  class LimitedJob extends Job {
    tries = 10;
    maxExceptions = 2;
    handle(): void {
      throws += 1;
      throw new Error("nope");
    }
  }

  let throws = 0;
  const { MemoryFailedJobRepository } = await import("../src/memory-failed.ts");
  const failed = new MemoryFailedJobRepository();
  const q = new QueueManager({ connection: "memory", failed });
  setQueue(q);

  await dispatch(new LimitedJob());
  await q.daemon({ once: true, sleep: 1 });

  expect(throws).toBe(2);
  expect(await failed.all()).toHaveLength(1);
});

test("worker times out long-running jobs", async () => {
  class SlowJob extends Job {
    tries = 1;
    timeout = 0.05;
    async handle(): Promise<void> {
      await Bun.sleep(200);
    }
  }

  const { MemoryFailedJobRepository } = await import("../src/memory-failed.ts");
  const failed = new MemoryFailedJobRepository();
  const q = new QueueManager({ connection: "memory", failed });
  setQueue(q);

  await dispatch(new SlowJob());
  await q.work("default", 1);

  const all = await failed.all();
  expect(all).toHaveLength(1);
  expect(all[0]!.exception).toContain("Job timed out");
});
