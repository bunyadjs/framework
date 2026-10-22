---
title: Rate Limiting
description: Limit how often an action or route may run with RateLimiter, Limit, and throttle middleware.
---

# Rate Limiting

## Introduction

Rate limiting caps how often a key may succeed inside a fixed time window. Use it for login attempts, API traffic, or any in-process action that should not run unbounded.

The API lives in `@bunyad/http`:

```ts
import {
  RateLimiter,
  Limit,
  getRateLimiter,
  setRateLimiter,
  registerRateLimitPresets,
  throttle,
} from "@bunyad/http";
```

`HttpServiceProvider` creates a `RateLimiter`, registers the built-in named limiters (`api`, `auth`, `tokens`), and calls `setRateLimiter`. Counters are an in-memory map on that instance. They reset when the process exits and are not shared across workers.

A minimal app that does not load the provider wires the limiter itself:

```ts
import {
  RateLimiter,
  registerRateLimitPresets,
  setRateLimiter,
} from "@bunyad/http";

const limiter = new RateLimiter();
registerRateLimitPresets(limiter);
setRateLimiter(limiter);
```

## Basic usage

Resolve the shared limiter with `getRateLimiter()`. `attempt` records one hit and returns a `RateLimitResult`:

```ts
import { getRateLimiter } from "@bunyad/http";

const limiter = getRateLimiter();
const result = limiter.attempt(`send-message:${userId}`, 5, 60);

if (!result.allowed) {
  return `Too many messages. Try again in ${result.retryAfter} seconds.`;
}

// Send the message…
```

Arguments are the key, the maximum attempts, and the window length in seconds. The result shape:

```ts
type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number; // seconds until reset when blocked; 0 when allowed
  resetAt: number; // epoch milliseconds when the window ends
};
```

### Manual hits

Check without always combining the write, or drive the counter yourself:

```ts
const key = `send-message:${userId}`;
const perMinute = 5;

if (limiter.tooManyAttempts(key, perMinute)) {
  const seconds = limiter.availableIn(key);
  return `You may try again in ${seconds} seconds.`;
}

limiter.hit(key, 60);
// Send the message…
```

`hit(key, decaySeconds?)` increments and returns the new attempt count (default decay 60 seconds). `increment(key, decaySeconds?, amount?)` calls `hit` repeatedly. `decrement` lowers the count. `attempts` / `remaining` / `retriesLeft` read the current window. `availableAt` returns a Unix timestamp (seconds). `availableIn` returns seconds until the window resets.

```ts
if (limiter.remaining(key, perMinute) > 0) {
  limiter.increment(key);
  // …
}

limiter.clear(key); // same as resetAttempts(key)
limiter.flush(); // clear every key
```

`cleanRateLimiterKey` strips `&` and `:` and truncates to 200 characters when you want a safe storage key.

## Defining rate limiters

Named limiters are callbacks registered with `for`. Each callback receives the HTTP `Request` (or another context object) and returns a `Limit` or an array of `Limit`s:

```ts
import { getRateLimiter, Limit } from "@bunyad/http";
import type { Request } from "@bunyad/http";

const limiter = getRateLimiter();

limiter.for("uploads", (request: Request) => {
  return Limit.perMinute(100).by(request.ip());
});
```

Build limits with:

| Builder | Window |
| --- | --- |
| `Limit.perMinute(n)` | `n` attempts per 60 seconds |
| `Limit.perSeconds(n, seconds)` | `n` attempts per `seconds` |
| `Limit.perHour(n)` | `n` attempts per 3600 seconds |

Chain `by(key)` to segment the counter (IP, user id, email, and so on):

```ts
limiter.for("uploads", (request: Request) => {
  const user = request.user as { id?: number } | undefined;
  return user?.id
    ? Limit.perMinute(100).by(user.id)
    : Limit.perMinute(10).by(request.ip());
});
```

### Multiple limits

Return an array. Every limit is evaluated in order. The first that blocks wins:

```ts
limiter.for("login", (request: Request) => {
  const email = String(request.input("email") ?? request.ip());
  return [
    Limit.perMinute(500).by(request.ip()),
    Limit.perMinute(3).by(`email:${email}`),
  ];
});
```

When two segments would collide, prefix the `by` value so the keys stay unique:

```ts
limiter.for("uploads", (request: Request) => {
  const id = (request.user as { id: number }).id;
  return [
    Limit.perMinute(10).by(`minute:${id}`),
    Limit.perHour(1000).by(`hour:${id}`),
  ];
});
```

### Built-in presets

`registerRateLimitPresets` registers three names:

| Name | Rule |
| --- | --- |
| `api` | 60 per minute by authenticated user id, or IP |
| `auth` | 5 per minute by IP (login / register) |
| `tokens` | 10 per hour by IP (token endpoints) |

`Limit.api`, `Limit.auth`, and `Limit.tokens` are the same builders if you call them yourself:

```ts
import { Limit } from "@bunyad/http";

const limit = Limit.api(request); // Limit.perMinute(60).by(user id or IP)
```

Look up a registered callback with `limiter.limiter("api")`.

## Attaching limiters to routes

Use the `throttle` middleware from `@bunyad/http`. Pass a max attempts count and a decay window in minutes (default one minute). The default key is the client IP:

```ts
import { Route } from "@bunyad/router";
import { throttle } from "@bunyad/http";

Route.middleware(throttle(60, 1)).group(() => {
  Route.post("/login", () => "ok");
});
```

Pass a string to use a named limiter:

```ts
Route.middleware(throttle("auth")).group(() => {
  Route.post("/login", [AuthController, "login"]);
});
```

String aliases work the same way once `throttle` is registered (the HTTP package registers it on import):

```ts
Route.middleware("throttle:60,1").post("/search", handler);
Route.middleware("throttle:auth").post("/login", handler);
Route.middleware("throttle").get("/api/me", handler); // named limiter "api"
```

Custom key or an explicit limiter instance:

```ts
Route.middleware(
  throttle(30, 1, {
    key: (request) => String(request.input("email") ?? request.ip()),
  }),
).post("/password/email", handler);
```

The web starter kits lock login out inside the login request itself: five failures per email and IP per minute, counted with `RateLimiter.hit` and cleared with `RateLimiter.clear` on success, so a correct password never uses up the budget. They throttle the two-factor challenge and verification mail with `throttle:5,1` / `throttle:6,1`. The API starter uses `throttle("tokens")` around register, a `token` limiter that counts only failed token requests, and `throttle("api")` around authenticated routes.

### Response when blocked

A blocked request returns HTTP 429 with JSON `{ "message": "Too Many Attempts." }` and these headers:

- `Retry-After` — seconds until the window resets
- `X-RateLimit-Limit` — max attempts
- `X-RateLimit-Remaining` — `0`

Allowed responses get `X-RateLimit-Limit` and `X-RateLimit-Remaining` added to the downstream response.

## Evaluating a named limiter yourself

Outside middleware, call `attemptNamed`:

```ts
const result = await getRateLimiter().attemptNamed("api", request);

if (!result.allowed) {
  return new Response(JSON.stringify({ message: "Too Many Attempts." }), {
    status: 429,
    headers: { "Retry-After": String(result.retryAfter) },
  });
}
```

Missing names throw: `Rate limiter [name] is not defined.`
