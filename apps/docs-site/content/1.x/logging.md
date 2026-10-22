---
title: Logging
description: Write application logs with Log.info, channels, and stack or single file drivers.
---

# Logging

## Introduction

`@bunyad/log` records what your app is doing. Call `Log.info` / `Log.error` from anywhere after the framework boots. Channels decide where each message goes — a file, the console, or a stack of both.

`LogServiceProvider` builds channels from `config/logging.ts` and registers the `Log` façade. Starters ship that config file; the provider also works with built-in defaults when the file is missing.

## Configuration

```ts title="config/logging.ts"
export default {
  default: process.env.LOG_CHANNEL ?? "stack",
  channels: {
    stack: {
      driver: "stack",
      channels: ["single"],
      level: process.env.LOG_LEVEL ?? "debug",
    },
    single: {
      driver: "single",
      path: "storage/logs/bunyad.log",
      level: process.env.LOG_LEVEL ?? "debug",
    },
    console: {
      driver: "console",
      level: process.env.LOG_LEVEL ?? "debug",
    },
  },
};
```

Relative `path` values resolve from the application base path. Absolute paths are used as-is.

| Driver | Behavior |
| --- | --- |
| `single` | Append every line to one file |
| `stack` | Fan out to the listed channel names |
| `console` | Write to stdout / stderr |

Levels (lowest to highest): `debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency`. A channel only records messages at or above its configured level.

## Writing log messages

```ts
import { Log } from "@bunyad/log";

Log.info("User logged in", { id: user.id });
Log.warning("Slow query", { ms: 420 });
Log.error("Payment failed", { orderId });
```

Optional context is JSON-encoded on the same line. Level methods (`info`, `error`, …) are **synchronous for callers** (`void`) — channel I/O is queued internally. Call `await Log.flush()` on shutdown (or in tests) if you need queued writes to finish.

### Shared context

`Log.shareContext` / `Log.withContext` merge values into every subsequent log line until you clear them:

```ts
Log.shareContext({ requestId: crypto.randomUUID() });
Log.info("started");
Log.withContext({ userId: user.id });
Log.info("authorized");
Log.withoutContext();
```

Per-call context still wins on key collisions. `Log.sharedContext()` returns a snapshot of the bag.

### Specific channels

```ts
Log.channel("console").debug("verbose trace");
Log.channel("single").error("persisted failure");
```

## Building stacks

A `stack` channel lists child channel names. Use it as the default so local development can also print to the console:

```ts
stack: {
  driver: "stack",
  channels: ["single", "console"],
  level: "debug",
},
```

## Testing

Swap the default channel for an in-memory or temp-file channel in tests by calling `setLogChannel` before the code under test, or point `LOG_CHANNEL` at `console`.
