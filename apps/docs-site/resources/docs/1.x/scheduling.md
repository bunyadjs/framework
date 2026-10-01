---
title: Task Scheduling
description: Define cron-style tasks in code and run them with schedule:work or schedule:run.
---

# Task Scheduling

## Introduction

The scheduler runs callbacks, console commands, queue jobs, and shell commands on a timetable you define in TypeScript. Instead of many crontab lines, you keep one schedule in the application and run a single worker that evaluates it every minute (or every second when a task uses sub-minute frequencies).

Schedules live in `routes/console.ts`. Export `registerSchedule`. The [console](/docs/1.x/console) commands `schedule:run`, `schedule:work`, and `schedule:list` load that file after the app boots. Production deployments can start the scheduler entry through [the compiler](/docs/1.x/compiler).

`@bunyad/schedule` provides `schedule()`, `Schedule`, and `ScheduledEvent`. Framework apps create the default schedule in `QueueServiceProvider` (mutex path under `storage/framework/schedule`, timezone from `APP_TIMEZONE`) and wire `schedule().job(...)` to `queue.dispatch`.

## Defining schedules

Create or edit `routes/console.ts` and export `registerSchedule`:

```ts
import { schedule } from "@bunyad/schedule";
import PruneExpiredTokens from "@/Jobs/PruneExpiredTokens.ts";

export function registerSchedule(): void {
  schedule()
    .call(() => {
      console.log(`[schedule] heartbeat ${new Date().toISOString()}`);
    })
    .everyMinute()
    .name("heartbeat")
    .withoutOverlapping(5)
    .onOneServer();

  schedule()
    .job(new PruneExpiredTokens())
    .hourly()
    .timezone("UTC")
    .name("job:PruneExpiredTokens");

  schedule()
    .command("queue:status")
    .everyFiveMinutes()
    .name("command:queue:status");
}
```

`registerSchedule` runs each time a schedule command starts. The CLI clears previous events, then imports this module and calls your function.

List what is registered:

```shell
bunyad schedule:list
```

### Closures

`schedule().call(callback)` registers any sync or async function. Chain a frequency method, then optional filters and hooks:

```ts
schedule()
  .call(async () => {
    // prune rows, ping a health URL, …
  })
  .dailyAt("13:00")
  .timezone("America/Chicago")
  .name("prune-recent");
```

### Console commands

`schedule().command(signature)` runs a built-in [console](/docs/1.x/console) command from the `bunyad` CLI registry (for example `queue:status`, `migrate`, `route:list`). The first token is the command name; the rest are arguments:

```ts
schedule().command("queue:status").hourly();
schedule().command("queue:status default").everyFiveMinutes();
```

The CLI sets `setScheduleCommandRunner` when you run `schedule:run` / `schedule:work` / `schedule:list`. Application command classes under `app/Console/Commands` are not invoked through `schedule().command` today — schedule those with `call` or `job` instead.

### Queued jobs

`schedule().job(job)` dispatches a `@bunyad/queue` `Job` when the event is due. The framework registers a job runner that calls `queue.dispatch`. The event description defaults to `job:${job.name}`:

```ts
import ProcessPodcast from "@/Jobs/ProcessPodcast.ts";

schedule().job(new ProcessPodcast(1)).everyFifteenMinutes();
```

### Shell commands

`schedule().exec(command)` runs the string with `Bun.spawn(["sh", "-c", command])`. Non-zero exit codes throw. Stdout is available to output helpers:

```ts
schedule()
  .exec("node ./scripts/backup.js")
  .daily()
  .sendOutputTo("storage/logs/backup.log");
```

### Schedule groups

`schedule().group(callback)` registers several events, then returns a `ScheduleEventGroup` so you can apply the same frequency or filters to all of them:

```ts
schedule()
  .group(() => {
    schedule().call(() => syncOrders()).name("sync-orders");
    schedule().call(() => syncInventory()).name("sync-inventory");
  })
  .hourly()
  .timezone("UTC")
  .withoutOverlapping();
```

The group helpers cover `daily`, `hourly`, `weekly`, `monthly`, `everyMinute`, `cron`, `timezone`, `environments`, `withoutOverlapping`, `onOneServer`, `when`, and `skip`.

## Schedule frequency options

You may set a raw cron expression or use fluent helpers. Expressions are five fields: minute, hour, day of month, month, day of week.

```ts
schedule().call(fn).cron("0 0 * * 0");
```

| Method | Expression / behavior |
| --- | --- |
| `everyMinute` | `* * * * *` |
| `everyTwoMinutes` … `everyThirtyMinutes` | `*/N * * * *` |
| `hourly` / `hourlyAt(offset)` | Top of the hour, or specific minutes |
| `everyOddHour` / `everyTwoHours` / … / `everySixHours` | Hour strides |
| `daily` / `dailyAt("13:00")` / `at("13:00")` | Once per day |
| `twiceDaily` / `twiceDailyAt` | Two hours per day |
| `weekly` / `weeklyOn(day, time)` | Weekly |
| `monthly` / `monthlyOn` / `twiceMonthly` / `lastDayOfMonth` | Monthly |
| `quarterly` / `quarterlyOn` | Quarterly |
| `yearly` / `yearlyOn` | Yearly |
| `weekdays` / `weekends` / `mondays` … `sundays` | Day-of-week filters |
| `days` / `daysOfMonth` | Custom day lists |

Sub-minute helpers use `repeatEvery(seconds)` under the hood and need a worker that ticks more than once per minute (`schedule:work` already sleeps 1s when any repeatable event exists):

```ts
schedule().call(fn).everyFiveSeconds();
schedule().call(fn).everyThirtySeconds();
```

`everySecond`, `everyTwoSeconds`, `everyTenSeconds`, `everyFifteenSeconds`, and `everyTwentySeconds` are also available.

## Timezones

`timezone(iana)` evaluates the cron expression in that zone. Events without a timezone use the schedule default (`APP_TIMEZONE` when the framework builds the schedule):

```ts
schedule().call(fn).dailyAt("8:00").timezone("Asia/Karachi");
```

## Preventing overlaps

`withoutOverlapping(expiresMinutes = 1440)` skips a run when a previous invocation still holds the lock. With a cache mutex store (wired by `CacheServiceProvider` via `setScheduleMutexStore`), the lock is a cache key. Otherwise a file under `storage/framework/schedule` is used:

```ts
schedule()
  .command("reports:generate")
  .hourly()
  .withoutOverlapping(120);
```

## Running on one server

`onOneServer()` allows only one process to win the lock for that minute. It requires the cache mutex store (`Cache.add` / `forget`). Without that store, the event throws when it tries to run:

```ts
schedule()
  .call(fn)
  .everyMinute()
  .name("heartbeat")
  .onOneServer();
```

Give overlapping and one-server events a stable `name(...)` so mutex keys stay predictable. `createMutexNameUsing(() => string)` overrides the key.

## Background tasks

`runInBackground()` starts the callback without awaiting it, so other due events in the same tick are not blocked. Failures still run `onFailure` hooks and failure emails/pings:

```ts
schedule().exec("long-running-backup.sh").daily().runInBackground();
```

## Environments, maintenance, and pause

```ts
schedule()
  .call(fn)
  .daily()
  .environments("production", "staging");

schedule().call(fn).hourly().evenInMaintenanceMode();
schedule().call(fn).everyMinute().evenWhenPaused();
```

`environments` compares against `APP_ENV` or `NODE_ENV`. Maintenance and pause flags are toggled with `setScheduleMaintenanceMode` and `setSchedulePaused` (tests and tooling). Events skip unless you opt in with `evenInMaintenanceMode` / `evenWhenPaused`.

## Filters

`when` and `skip` add boolean (or promise) gates. `between` / `unlessBetween` use `HH:MM` clocks in the event timezone:

```ts
schedule()
  .call(fn)
  .everyMinute()
  .between("8:00", "17:00")
  .when(() => process.env.FEATURE_SYNC === "1")
  .skip(() => isHoliday());
```

## Task output

Capture string or JSON results from callbacks and successful `exec` stdout:

```ts
schedule()
  .exec("node ./scripts/report.js")
  .daily()
  .sendOutputTo("storage/logs/report.log")
  .emailOutputTo("ops@example.com")
  .emailOutputOnFailure("oncall@example.com");
```

`appendOutputTo` appends instead of overwriting. `emailOutputTo` / `emailWrittenOutputTo` skip empty success bodies. Mail requires the framework mail sender (`MailServiceProvider` wires `setScheduleMailSender`).

## Task hooks and pings

```ts
schedule()
  .call(fn)
  .hourly()
  .before(async (event) => {})
  .onSuccess(async (event) => {})
  .onFailure(async (event) => {})
  .after(async (event) => {})
  .onSuccessWithOutput(async (output, event) => {})
  .pingBefore("https://example.com/ping/start")
  .pingOnSuccess("https://example.com/ping/ok")
  .pingOnFailure("https://example.com/ping/fail");
```

`then` is an alias of `after`. `thenWithOutput` aliases `onSuccessWithOutput`. Conditional ping helpers (`pingBeforeIf`, `thenPingIf`, `pingOnSuccessIf`, `pingOnFailureIf`) register only when the boolean is true. Pings default to `fetch`; override with `setScheduleHttpClient` in tests.

## Running the scheduler

Run due events once (typical crontab entry):

```shell
bunyad schedule:run
```

Run a long-lived worker that evaluates the schedule every minute (or every second when sub-minute events exist):

```shell
bunyad schedule:work
bunyad schedule:work --once
```

`--once` performs a single tick and exits. The daemon stops on SIGINT/SIGTERM.

On a server without the daemon, point cron at `schedule:run` every minute:

```cron
* * * * * cd /path/to/app && bunyad schedule:run >> /dev/null 2>&1
```

Compiled apps can use `bunyad start --entry=scheduler` or `bunyad workers --schedule`. See [the compiler](/docs/1.x/compiler).

From code, after registering events:

```ts
import { getSchedule } from "@bunyad/schedule";

await getSchedule().run();
await getSchedule().work({ once: true });
```
