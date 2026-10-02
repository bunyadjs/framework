# @bunyad/schedule

A cron-style task scheduler with a fluent frequency API for callbacks, jobs and commands, plus overlap protection, environment filters and a daemon loop.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/schedule@beta
# or: npm install @bunyad/schedule@beta
```

## Usage

```ts
import { Schedule, cronMatches, setSchedule, schedule } from "@bunyad/schedule";

setSchedule(new Schedule());

schedule().call(() => console.log("tick")).everyMinute().name("heartbeat");
schedule().call(() => console.log("report")).dailyAt("13:00").weekdays().name("report");

// Run whatever is due at a given moment; resolves to the number of events run
await schedule().run(new Date(2026, 0, 5, 13, 0, 0)); // Monday 13:00 -> logs "tick", "report"; returns 2
await schedule().run(new Date(2026, 0, 5, 13, 1, 0)); // logs "tick"; returns 1

cronMatches("*/15 * * * *", new Date(2026, 0, 15, 14, 30, 0)); // true
```

In production, `await schedule().work({ signal })` runs due events every minute until aborted (`{ once: true }` runs a single tick). Besides `call`, there are `job({ name, handle })` and `command("name arg")`, which execute through runners you register with `setScheduleJobRunner` and `setScheduleCommandRunner`.

## Notes

- Bun only (Bun 1.4 or newer).
- Frequencies: `everyMinute`, `hourly`, `dailyAt`, `weeklyOn`, `monthly`, `cron("* * * * *")` and more. Constraints: `weekdays`, `between`, `timezone`, `environments`, `when`/`skip`.
- `withoutOverlapping()` uses a file-based mutex; `onOneServer()` requires a shared store set with `setScheduleMutexStore()`.
- Output and hooks: `sendOutputTo`, `before`, `after`, `onSuccess`, `onFailure`, `pingOnSuccess`.
- No runtime dependencies.

## License

MIT
