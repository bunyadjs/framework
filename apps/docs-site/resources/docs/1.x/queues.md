---
title: Queues
description: Dispatch jobs to workers, choose a connection, and retry or flush failed work.
---

# Queues

## Introduction

Queues let you defer slow work so an HTTP request can finish quickly. You write a job class, dispatch it, and a worker process pulls jobs from a connection and runs `handle`.

`@bunyad/queue` provides the `Job` base class, `dispatch`, the `Queue` and `Bus` facades, drivers (`sync`, `memory`, `database`, `redis`), failed-job storage, job middleware, uniqueness locks, and batching. A framework app boots that stack through `QueueServiceProvider`.

Workers are [console](/docs/1.x/console) commands (`queue:work`, `queue:failed`, and the rest). In production you usually run them through [the compiler](/docs/1.x/compiler) (`bunyad start --entry=queue` or `bunyad workers --queue=1`).

## Configuration

Framework apps read `config/queue.ts`. The default connection is `QUEUE_CONNECTION`, or `sync` when that variable is unset:

```ts
export default {
  default: process.env.QUEUE_CONNECTION ?? "sync",
  tries: Number(process.env.QUEUE_TRIES ?? 1),
  connections: {
    sync: { driver: "sync" },
    memory: { driver: "memory" },
    database: { driver: "database" },
    redis: {
      driver: "redis",
      connection: "default",
      url: process.env.REDIS_URL,
    },
  },
  failed: {
    driver: process.env.QUEUE_FAILED_DRIVER ?? "memory",
  },
};
```

`QueueServiceProvider` builds a `QueueManager`, calls `setQueue`, binds `"queue"` on the container, and points mail at the same manager.

| Driver | Behavior |
| --- | --- |
| `sync` | Runs the job in the current process as soon as it is dispatched. |
| `memory` | Stores payloads in process memory. Lost when the process exits. |
| `database` | Stores JSON payloads in a `jobs` table. Requires the jobs migration. |
| `redis` | Uses Redis lists. Needs `REDIS_URL` (or the connection `url`). |

Failed jobs use a memory repository by default. When the active driver is `database`, or `failed.driver` / `QUEUE_FAILED_DRIVER` is `database`, failures go to a `failed_jobs` table.

### Database tables

For the database driver, create the jobs table:

```ts
await schema.create("jobs", (table) => {
  table.id();
  table.string("queue");
  table.text("payload");
  table.integer("attempts").default(0);
  table.integer("reserved_at").nullable();
  table.integer("available_at");
  table.integer("created_at");
});
```

For durable failed jobs:

```ts
await schema.create("failed_jobs", (table) => {
  table.id();
  table.string("uuid").unique();
  table.string("queue");
  table.text("payload");
  table.text("exception");
  table.integer("failed_at");
});
```

Batches that should survive restarts need `job_batches` and an explicit `setBatchRepository(new DatabaseBatchRepository({ connection }))`. The framework default batch store is in memory.

## Creating jobs

`bunyad make:job ProcessPodcast` writes `app/Jobs/ProcessPodcastJob.ts`:

```ts
import { Job } from "@bunyad/queue";

export default class ProcessPodcastJob extends Job {
  async handle(): Promise<void> {
    console.log("[job] ProcessPodcastJob");
  }
}
```

Pass constructor data as public fields. Override properties on the class when you need a different queue, connection, or retry budget:

```ts
import { Job } from "@bunyad/queue";
import Podcast from "@/Models/Podcast.ts";

export default class ProcessPodcast extends Job {
  queue = "podcasts";
  connection = "redis";
  tries = 3;
  delay = 0;

  constructor(public podcastId: number) {
    super();
  }

  async handle(): Promise<void> {
    const podcast = await Podcast.find(this.podcastId);
    // …
  }
}
```

| Property | Role |
| --- | --- |
| `queue` | Queue name (default `"default"`). |
| `connection` | Named connection when you registered one with `Queue.extend`. |
| `tries` / `maxTries` | Attempts before the job is marked failed. |
| `delay` | Seconds before the job is available (ignored by `sync`). |
| `afterCommit` | Wait for the outermost DB transaction to commit before pushing. |

`Job` also exposes `timeout`, `backoff`, `retryUntil`, and `maxExceptions` for your own use. The worker today retries by `tries` only.

Inside `handle` you can call `this.delete()`, `this.release(seconds)`, or `this.fail()`. Override `failed(error)` for permanent failures. Override `middleware()` to return job middleware (see below).

## Dispatching jobs

Import `dispatch` from `@bunyad/queue`, or use the global `dispatch` that the framework installs:

```ts
import { dispatch } from "@bunyad/queue";
import ProcessPodcast from "@/Jobs/ProcessPodcast.ts";

await dispatch(new ProcessPodcast(1));
```

`dispatch` returns a `PendingDispatch`. Configuration methods chain in the same tick before the push runs on a microtask. You can also `await` the builder; it is thenable and resolves to the job id:

```ts
await dispatch(new ProcessPodcast(1))
  .onQueue("podcasts")
  .onConnection("redis")
  .delay(60)
  .afterCommit();
```

| Method | Effect |
| --- | --- |
| `delay(seconds)` | Sets availability delay. |
| `onQueue(name)` | Sets the queue name (marks it explicit for routing). |
| `onConnection(name)` | Routes to a named connection. |
| `chain(jobs)` | Runs those jobs after this one succeeds. |
| `afterResponse()` | Defers the push with a macrotask so the HTTP response can finish first. |
| `afterCommit()` | Pushes after the current DB transaction commits. |

`Queue.later(seconds, job)` and `Bus.dispatch(job)` are the same fluent path. `Bus.dispatchSync(job)` / `Bus.dispatchNow(job)` run the middleware stack and `handle` immediately, without going through the driver. `Bus.dispatchAfterResponse(job)` is `afterResponse()`. `Bus.bulk(jobs, queue?)` pushes many jobs and returns their ids.

## Job chains

Chain jobs so the next one starts only after the previous succeeds:

```ts
import { Bus } from "@bunyad/queue";
import OptimizePodcast from "@/Jobs/OptimizePodcast.ts";
import ProcessPodcast from "@/Jobs/ProcessPodcast.ts";
import ReleasePodcast from "@/Jobs/ReleasePodcast.ts";

await Bus.chain([
  new ProcessPodcast(1),
  new OptimizePodcast(1),
  new ReleasePodcast(1),
])
  .onQueue("podcasts")
  .delay(10)
  .catch(async (error) => {
    console.error(error);
  })
  .dispatch();
```

You can also attach a chain on a single dispatch: `dispatch(first).chain([second, third])`.

## Job batches

`Bus.batch` tracks a set of jobs as one unit. Callbacks receive a `Batch` instance:

```ts
import { Bus } from "@bunyad/queue";
import ImportCsvChunk from "@/Jobs/ImportCsvChunk.ts";

const batch = await Bus.batch([
  new ImportCsvChunk(1),
  new ImportCsvChunk(2),
])
  .name("csv-import")
  .onQueue("imports")
  .then(async (batch) => {
    console.log(`Finished ${batch.id}`);
  })
  .catch(async (batch, error) => {
    console.error(batch.id, error);
  })
  .finally(async (batch) => {
    // …
  })
  .progress(async (batch) => {
    console.log(`${batch.progress()}%`);
  })
  .allowFailures()
  .dispatch();

const again = await Bus.findBatch(batch.id);
```

Without `allowFailures()`, the first permanent failure cancels the batch; remaining jobs are skipped. `batch.cancel()`, `batch.add(jobs)`, and `batch.fresh()` manage a running batch. Progress is stored in the batch repository (memory by default).

## Queue routing

`Queue.route` sets a default queue and/or connection for a job class when the job does not already set them explicitly:

```ts
import { Queue } from "@bunyad/queue";
import ProcessPodcast from "@/Jobs/ProcessPodcast.ts";

Queue.route(ProcessPodcast, { connection: "redis", queue: "podcasts" });
Queue.route(ProcessPodcast, "podcasts", "redis");
```

`onQueue` / `onConnection` on `PendingDispatch` win over routes. `Queue.clearRoutes()` clears the map (useful in tests).

## Serializing models

Drivers that serialize payloads (`database`, `redis`) store plain data. Decorate a job with `@SerializesModels()` so models become `{ class, key }` and are reloaded with `Model.find` when the worker runs:

```ts
import { Job, SerializesModels } from "@bunyad/queue";
import User from "@/Models/User.ts";

@SerializesModels()
export default class SendWelcome extends Job {
  constructor(public user: User) {
    super();
  }

  async handle(): Promise<void> {
    // this.user is re-fetched for the worker process
  }
}
```

Import the model (or call `registerSerializableModel`) in the worker process before those jobs run so the class registry knows how to restore them.

## Unique jobs

Implement `uniqueId()` on the job. Dispatch acquires a cache lock (`Cache.add`). A duplicate returns an empty id and is not pushed:

```ts
import { Job } from "@bunyad/queue";
import type { ShouldBeUnique } from "@bunyad/queue";

export default class UpdateSearchIndex extends Job implements ShouldBeUnique {
  uniqueFor = 3600;

  constructor(public productId: number) {
    super();
  }

  uniqueId(): string {
    return String(this.productId);
  }

  async handle(): Promise<void> {
    // …
  }
}
```

Set `shouldBeUniqueUntilProcessing = true` (or implement `uniqueUntilProcessing()`) to release the lock when processing starts instead of when the job finishes.

## Job middleware

Override `middleware()` to wrap `handle`. Built-ins use the cache and rate limiter:

```ts
import {
  Job,
  WithoutOverlapping,
  RateLimited,
  Limit,
  type JobMiddleware,
} from "@bunyad/queue";

export default class GenerateReport extends Job {
  middleware(): JobMiddleware[] {
    return [
      new WithoutOverlapping(this.reportId).releaseAfter(60).expireAfter(300),
      new RateLimited().using(() => Limit.perMinute(10)),
    ];
  }

  constructor(public reportId: string) {
    super();
  }

  async handle(): Promise<void> {
    // …
  }
}
```

`WithoutOverlapping` locks with `Cache.add`. When the lock is held it calls `job.release` unless you use `dontRelease()`. `RateLimited` takes a named limiter from `RateLimiter.for`, or an inline `using()` factory. Custom middleware is a class with `handle(job, next)` or a function with the same shape.

## Named connections

Register extra managers with `Queue.extend`, then dispatch with `onConnection` or `job.connection`:

```ts
import { Queue, QueueManager, RedisQueueDriver } from "@bunyad/queue";

Queue.extend("redis-high", () =>
  new QueueManager({
    driver: new RedisQueueDriver({ url: process.env.REDIS_URL }),
  }),
);

await dispatch(new ProcessPodcast(1)).onConnection("redis-high");
```

`Queue.connection(name)` returns that manager. `Queue.setDefaultDriver(name)` changes the default name used by the facade.

## Running workers

Process jobs from the default connection:

```shell
bunyad queue:work
bunyad queue:work --queue=podcasts
bunyad queue:work --once
bunyad queue:work --sleep=3
```

`--once` exits when the queue is empty. `--sleep` is the idle poll interval in seconds (default `1`). The worker stops on SIGINT/SIGTERM.

| Command | Role |
| --- | --- |
| `queue:work` | Daemon (or `--once`) that pops and runs jobs. |
| `queue:status [name]` | Pending size and failed count. |
| `queue:failed` | List failed jobs. |
| `queue:retry <uuid>` | Re-queue one failed job. |
| `queue:retry --all` | Re-queue every failed job. |
| `queue:flush` | Delete all failed jobs. |

See [console](/docs/1.x/console) for how `bunyad` boots the app before these commands run. For compiled deployments, start a queue entry or supervisor as described in [the compiler](/docs/1.x/compiler).

You can also drive the manager from code:

```ts
import { getQueue } from "@bunyad/queue";

await getQueue().work("default", 5);
await getQueue().daemon({ queue: "default", sleep: 1000, once: true });
```

`Queue.pause("default")` / `Queue.resume("default")` / `Queue.pauseFor(seconds)` stop and resume popping for a queue name. Lifecycle hooks (`Queue.before`, `after`, `failing`, `looping`, `exceptionOccurred`, `starting`, `stopping`) register callbacks the worker fires around each job.

## Testing

`Queue.fake()` swaps the default manager for one that records pushes instead of running them:

```ts
import { Queue } from "@bunyad/queue";
import ProcessPodcast from "@/Jobs/ProcessPodcast.ts";

Queue.fake();

await dispatch(new ProcessPodcast(1));

Queue.assertPushed(ProcessPodcast);
Queue.assertPushedTimes(ProcessPodcast, 1);
Queue.assertNotPushed("SomeOtherJob");
Queue.assertNothingPushed(); // fails if anything was pushed

Queue.restore();
```

Assertions throw when they fail. Call `Queue.fake()` before the code under test.
