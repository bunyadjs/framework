---
title: Concurrency
description: Overlap independent async work with Promise.all and Promise.allSettled, and schedule post-response batches with defer.
---

# Concurrency

## Introduction

When several slow tasks do not depend on each other, start them together and wait for all of them. Bunyad does **not** ship a `Concurrency` facade — use the platform APIs Bun already gives you:

- [`Promise.all`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all) when every task must succeed
- [`Promise.allSettled`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled) when you want every outcome, including rejections
- [`defer`](/docs/1.x/helpers#defer) from `@bunyad/common` when the work can run **after** the HTTP response

That is I/O concurrency on Bun's event loop — overlapping `fetch`, database queries, and other awaits. For isolated OS processes or CPU-bound work, use `Bun.spawn` or `Worker` yourself.

```ts
import User from "@/Models/User.ts";
import Order from "@/Models/Order.ts";

const [userCount, orderCount] = await Promise.all([
  User.query().count(),
  Order.query().count(),
]);
```

## Running tasks in parallel

Pass an array of promises (or thenables). Results come back in the same order as the inputs. If any promise rejects, `Promise.all` rejects with that reason and the other results are discarded from the caller's perspective (in-flight work may still finish).

```ts
import User from "@/Models/User.ts";
import Order from "@/Models/Order.ts";

const [userCount, orderCount] = await Promise.all([
  User.query().count(),
  Order.query().count(),
]);
```

You can wrap each task in an async function when you need local logic:

```ts
const [users, orders] = await Promise.all([
  async () => {
    const count = await User.query().count();
    return { count };
  },
  async () => {
    const count = await Order.query().count();
    return { count };
  },
].map((fn) => fn()));
```

Prefer starting the promises directly when the expressions are already async — no extra wrapper is required.

### Named (keyed) results

Build a map of keys to promises, then zip the keys back onto `Promise.all` results:

```ts
import User from "@/Models/User.ts";
import Order from "@/Models/Order.ts";

const tasks = {
  users: User.query().count(),
  orders: Order.query().count(),
} as const;

const keys = Object.keys(tasks) as Array<keyof typeof tasks>;
const values = await Promise.all(keys.map((key) => tasks[key]));

const results = Object.fromEntries(
  keys.map((key, i) => [key, values[i]]),
) as { [K in keyof typeof tasks]: Awaited<(typeof tasks)[K]> };

const userCount = results.users;
const orderCount = results.orders;
```

A small helper keeps that pattern reusable:

```ts
async function allKeyed<T extends Record<string, Promise<unknown>>>(
  tasks: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  const keys = Object.keys(tasks) as Array<keyof T>;
  const values = await Promise.all(keys.map((key) => tasks[key]));
  return Object.fromEntries(keys.map((key, i) => [key, values[i]])) as {
    [K in keyof T]: Awaited<T[K]>;
  };
}

const results = await allKeyed({
  users: User.query().count(),
  orders: Order.query().count(),
});
```

### Settled results

Use `Promise.allSettled` when one failure must not discard the rest. Each entry is either `{ status: "fulfilled", value }` or `{ status: "rejected", reason }`:

```ts
const settled = await Promise.allSettled([
  User.query().count(),
  Order.query().count(),
  fetch("https://example.com/metrics").then((r) => r.json()),
]);

for (const result of settled) {
  if (result.status === "fulfilled") {
    console.log(result.value);
  } else {
    console.error(result.reason);
  }
}
```

Keyed settled work follows the same zip pattern as `Promise.all`.

## Deferring parallel work after the response

When you do **not** need the return values in the response, schedule the batch with [`defer`](/docs/1.x/helpers#defer). The HTTP kernel calls `flushDeferred` once the response is ready; that is when the deferred callback runs. Wrap `Promise.all` (or `allSettled`) inside the deferred callback so the overlap still happens — but only after the client has the response.

```ts
import { defer } from "@bunyad/common";
import Metrics from "@/Services/Metrics.ts";

defer(() =>
  Promise.all([
    Metrics.report("users"),
    Metrics.report("orders"),
  ]),
);
```

Use `defer` for post-response side effects (metrics, cache warm, search indexing). Keep anything the response body needs on the request path with a plain `await Promise.all(...)`.

Mark a job with `.always()` so it still runs when the request failed:

```ts
defer(() =>
  Promise.all([
    Metrics.report("users"),
    Metrics.report("orders"),
  ]),
).always();
```

In CLI scripts or tests there is no response cycle. Call `flushDeferred` yourself after you schedule work:

```ts
import { defer, flushDeferred } from "@bunyad/common";

defer(() => Promise.all([Metrics.report("users")]));
await flushDeferred();
```

See [Helpers](/docs/1.x/helpers#defer) for the full `defer` / `flushDeferred` API.

## Processes and workers

`Promise.all` overlaps awaits on one event loop. It does not fork child processes. When you need isolation or CPU parallelism:

- [`Bun.spawn`](https://bun.com/docs/runtime/spawn) for subprocesses
- [`Worker`](https://developer.mozilla.org/en-US/docs/Web/API/Worker) for parallel JS threads

Those APIs are outside Bunyad's helpers — use them directly in application code.
