# @bunyad/log

Channel-based logging (single file, daily rotating file, console, stack) with level filtering and shared context.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/log@beta
# or: npm install @bunyad/log@beta
```

## Usage

```ts
import { ConsoleChannel, DailyChannel, Log, StackChannel, setLogChannel } from "@bunyad/log";

setLogChannel(
  new StackChannel({
    channels: [
      new DailyChannel({ path: "storage/logs/app.log", level: "warning", days: 14 }),
      new ConsoleChannel({ level: "debug" }),
    ],
  }),
);

Log.info("user signed in", { user: 1 });
// console: [2026-10-02T18:58:53.598Z] INFO: user signed in {"user":1}
Log.error("payment failed");
// console and storage/logs/app-2026-10-02.log: ... ERROR: payment failed

await Log.flush(); // wait for pending writes before exiting
```

Levels are filtered per channel (here `info` reaches only the console). `SingleChannel` writes one file; `DailyChannel` writes `app-YYYY-MM-DD.log` and prunes files older than `days`. Shared context: `Log.shareContext({ requestId })`.

## Notes

- Bun only (Bun 1.4 or newer).
- Writes are queued, so call `await Log.flush()` before the process exits.
- Register extra channels with `setLogChannel(channel, "name")`, log to one with `Log.channel("name")`, and switch the default with `setDefaultLogChannel("name")`.
- Depends on `@bunyad/contracts`.

## License

MIT
