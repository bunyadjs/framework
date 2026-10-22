---
title: Session
description: Configure the session store, read and write the bag, and flash data for the next request.
---

# Session

## Introduction

HTTP is stateless. The session keeps a bag of data for one browser across requests: the signed-in user id, a flash message, the CSRF token, the previous URL. The `web` middleware group starts it.

```ts
import { verifyCsrf } from "@bunyad/auth";
import { startSession } from "@bunyad/session";

app.middlewareGroup("web", [startSession(), verifyCsrf()]);
```

`startSession` reads the `bunyad_session` cookie, loads the bag from the store, and sets `request.session`. After the action returns, changed bags are written back. A new session cookie is sent when the id was just created and the response is HTML (or an Inertia response). A JSON response does not receive a new cookie unless the bag changed.

### Configuration

`config/session.ts` selects the store. The framework reads it when `SessionServiceProvider` boots.

```ts title="config/session.ts"
export default {
  driver: process.env.SESSION_DRIVER ?? "file",
  lifetime: Number(process.env.SESSION_LIFETIME ?? 120),
  files: undefined as string | undefined,
  connection: process.env.SESSION_CONNECTION,
  table: process.env.SESSION_TABLE ?? "sessions",
  store: process.env.SESSION_STORE ?? "default",
  prefix: process.env.SESSION_COOKIE_PREFIX ?? "bunyad_session:",
};
```

| Key | Role |
| --- | --- |
| `driver` | `file` (default), `database`, `redis`, `memory`, or `array` |
| `lifetime` | Minutes the bag and cookie stay valid. Default 120. Applied to file (mtime), database, and Redis. Sets cookie `Max-Age` |
| `files` | Directory for the file driver. Default `storage/framework/sessions` |
| `connection` | Database connection name |
| `table` | Database table. Default `sessions` |
| `store` | Redis connection name from the database config. Default `default` |
| `prefix` | Redis key prefix. Default `bunyad_session:` |
| `encrypt` | When `false`, skip payload encryption even if `APP_KEY` is set. Default encrypts when a key is available |

`memory` and `array` are the same in-memory store. They are for tests and a single process. The file driver writes one JSON file per session id and drops files older than `lifetime`. Database and Redis drop a row after `lifetime` minutes.

When `APP_KEY` is set, the payload is encrypted before write and decrypted on read (all drivers). Older plaintext rows still load so sessions migrate in place.

The session cookie uses `Max-Age` equal to `lifetime` minutes. `HttpOnly` is always set. `Path` is `/`. `SameSite` defaults to `Lax`. `Secure` is set for HTTPS requests, when the environment is production, and whenever `SameSite` is `None`.

Override the cookie when you call the middleware:

```ts
startSession({
  cookie: "bunyad_session",
  lifetime: 120,
  domain: ".example.com",
  sameSite: "Lax",
  secure: true,
});
```

Passing `store` skips the store registered by the provider. The middleware throws if neither is set.

### Driver prerequisites

The file driver needs a writable `storage/framework/sessions` directory. The database driver needs a `sessions` table: `id`, nullable `user_id`, `ip_address`, and `user_agent`, plus `payload` and `last_activity`. The Redis driver needs the Redis URL configured under `database.redis` for the `store` name. `memory` needs nothing outside the process, and it is empty again when the process exits.

## Interacting with the session

Every method below is on `request.session`. The property is missing when `startSession` did not run for the route.

### Retrieving data

`get(key, default)` returns the value, or `default` when the key is absent. `all()` returns a copy of the bag, including internal keys such as `_token` and `_flash`. `only(keys)` returns just those keys that exist. `except(keys)` returns everything else. `exists(key)` is true when the key is present, including when the value is `null`. `has(key)` is true when the key is present and the value is not `null`. Pass an array to `has` when every key must be present. `hasAny(keys)` is true when one of them is. `missing(key)` is the opposite of `exists`.

```ts
const userId = request.session?.get("user_id");
const name = request.session?.get("name", "Guest");

if (request.session?.has("user_id")) {
  // ...
}
```

`pull(key, default)` returns the value and deletes the key. `remove(key)` does the same and does not take a default.

`remember(key, callback)` returns the stored value, or runs the callback, stores the result, and returns it.

```ts
const count = request.session?.remember("count", () => 0);
```

### Storing data

`put(key, value)` sets one entry. `put({ theme: "dark", locale: "en" })` sets many. `push(key, value)` appends to an array at that key, starting from an empty array when the key is missing or not an array. `increment(key, amount)` adds to a number (default amount `1`) and returns the new value. `decrement(key, amount)` subtracts. `replace(attributes)` swaps the whole bag.

```ts
request.session?.put("user_id", user.id);
request.session?.push("cart", productId);
request.session?.increment("visits");
```

A write marks the session dirty. The middleware then saves it. Reading does not.

### Flash data

`flash(key, value)` stores a value for this request and the next one. After the next request the middleware ages it out. Use it for a status line that should survive one redirect.

```ts
request.session?.flash("status", "Profile updated.");
return redirect("/profile");
```

`now(key, value)` stores a value for the rest of this request only. It is gone on the next one. `reflash()` keeps every current flash key for one more request. `keep("status", "notice")` keeps just those keys.

`flashInput(input)` flashes the object as `_old_input`. `getOldInput(key, default)` reads one field, or the whole object when you omit the key. `hasOldInput(key)` reports whether it was flashed. In a view, `old('email')` reads the same bag from `_old`.

```ts
request.session?.flashInput({ email: request.string("email") });
```

Validation of an HTML form flashes the old input for you and strips `password`.

### Deleting data

`forget(key)` removes one key. `forget(["cart", "coupon"])` removes several. `flush()` removes every key, including flash data. `invalidate()` flushes and rotates the id, destroying the previous store record.

```ts
request.session?.forget("user_id");
request.session?.flush();
```

### Regenerating the session ID

`regenerate()` issues a new id and a new CSRF token. Pass `true` to delete the previous store record. Call it after login so a stolen cookie cannot be reused.

```ts
request.session?.regenerate(true);
request.session?.put("user_id", user.id);
```

`migrate(destroy)` is the same operation. The id is a 40-character hex string or a UUID. `startSession` replaces anything else. `token()` is the CSRF token. `regenerateToken()` replaces `_token` without rotating the session id.

`previousUrl()` is the URL stored for `redirect().back()`. `setPreviousUrl` is what the middleware uses. You rarely call it yourself.

## Concurrent requests (`Session.block`)

By default, two requests that share a session id can run at the same time. Routes that both write the session can lose updates. Opt in with `Session.block()` (or `Route.get(…).block()`):

```ts
import { Session } from "@bunyad/session";

Route.get("/profile", handler).middleware(Session.block());
// hold up to 10s, wait up to 10s (defaults)
Route.post("/order", handler).block(10, 10);
```

While the lock is held, other blocked routes with the same session id wait. Requires a cache store (uses `Cache.lock`). The session cookie name and `XSRF-TOKEN` stay outside application cookie encryption — see [Responses](/docs/1.x/responses).

## CSRF

`verifyCsrf()` in the `web` group checks state-changing requests. The token is `request.session.token()`, and `regenerate()` replaces it. The [CSRF Protection](/docs/1.x/csrf) page covers origin checks, excluded paths, and the headers a form or a script must send.
