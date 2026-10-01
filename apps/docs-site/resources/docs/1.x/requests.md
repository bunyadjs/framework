---
title: HTTP Requests
description: Read the path, headers, input, cookies, old input, and uploaded files from the current request.
---

# HTTP Requests

## Introduction

The kernel wraps Bun’s request in `Request` from `@bunyad/http` and passes it to your action. Route parameters, the query string, and the body are available from that object.

## Interacting with the request

### Accessing the request

Accept `Request` as the first argument of a closure or a controller method.

```ts
import type { Request } from "@bunyad/http";

Route.get("/users", (request: Request) => {
  return request.string("q", "");
});
```

`request.raw` is the underlying Fetch request when you need a header or a body the wrapper does not already expose.

### Request path, host, and method

```ts
request.method;
request.path();
request.url;
request.isMethod("post");
```

`path()` has no leading slash, except for `/`, which stays `/`. `isMethod` ignores case. `request.host()` is the host header. `request.scheme()` is `http` or `https`.

### Request headers

`header` reads one header. Names are case-insensitive.

```ts
request.header("accept");
request.header("x-request-id", "none");
```

`bearerToken()` returns the token from `Authorization: Bearer ...`, without the `Bearer ` prefix.

### Request IP address

`request.ip()` is the client address. By default, `X-Forwarded-For` is ignored, so a caller cannot pick their own IP by setting that header. Call `setTrustedProxies` at boot when the application sits behind a proxy you control:

```ts
import { setTrustedProxies } from "@bunyad/http";

setTrustedProxies(["10.0.0.1"]);
```

Pass `"*"` only when every connecting address is a proxy you trust. After that, `ip()` uses the forwarded value.

### Content negotiation

`wantsJson()` is true when the preferred `Accept` type is JSON. `expectsJson()` is true in that case, and also when the call is an AJAX request that accepts any type. Error pages use `expectsJson()` to choose JSON or HTML. See [error handling](/docs/1.x/errors).

```ts
request.ajax();
request.pjax();
request.expectsJson();
```

`ajax()` checks `X-Requested-With: XMLHttpRequest`.

## Input

### Retrieving input

`input` reads one value. Route parameters win over the body, and the body wins over the query string. The second argument is the default when the key is missing.

```ts
const name = request.input("name");
const nameOrGuest = request.string("name", "Guest");
const page = request.integer("page", 1);
const price = request.float("price", 0);
const remember = request.boolean("remember");
```

Dot keys walk nested data: `request.input("user.name")`.

| Method | Returns |
| --- | --- |
| `input(key, default?)` | The raw value |
| `string(key, default?)` | A string |
| `integer(key, default?)` | An integer, or the default when the value is empty or not a number |
| `float(key, default?)` | A float, or the default |
| `boolean(key, default?)` | `true` for `true`, `1`, `"1"`, `"true"`, `"on"`, and `"yes"` |
| `all()` | Query, body, and route parameters merged |
| `only(keys)` | Those keys from `all()` |
| `except(keys)` | `all()` without those keys |
| `collect(key?)` | A collection of the value, or of every value when the key is omitted |

`boolean` treats a missing key as the default, which is `false` when you omit it.

### Input presence

```ts
request.has("name");
request.has("name", "email");
request.hasAny("name", "email");
request.filled("name");
request.missing("name");
```

`has` is true when every key is present, including a key whose value is an empty string. `filled` is false for `null` and `""`. `missing` is the opposite of `has` for one key.

`whenFilled` and `whenHas` run a callback only in that case:

```ts
request.whenFilled("name", (name) => {
  console.log(name);
});
```

### Merging additional input

`merge` writes keys into the input bag. Later `input` calls see them. `mergeIfMissing` writes a key only when it is not already present.

```ts
request.merge({ page: 1 });
request.mergeIfMissing({ currency: "PKR" });
```

### Old input

`flash` stores the current input in the session under `_old_input`, for the next request. `flashOnly` and `flashExcept` limit which keys are stored. Validation failures do this for you and drop `password` before the redirect. Read it back from the session in the form:

```ts
request.flash();
request.flashOnly("email");
request.flashExcept("password");
```

After a failed validation redirect, the old input is in the session under `_old`. Views read it with `old('email')` without the controller passing anything; Inertia pages keep their own form state.

### Cookies

```ts
request.cookie("theme");
request.cookie("theme", "light");
```

The second argument is the default when the cookie is absent. Setting a cookie is a method on the response, not the request.

## Files

### Retrieving uploaded files

`file` returns the uploaded file for a key, or an array when the field was submitted more than once.

```ts
const avatar = request.file("avatar");
if (avatar && !Array.isArray(avatar)) {
  avatar.getClientOriginalName();
}
```

`hasFile` reports whether a file was uploaded for that key.

### Storing uploaded files

Call `store` on the file with a directory and a disk name when you want the file written through the filesystem manager. The method returns the stored path.

```ts
const avatar = request.file("avatar");
if (avatar && !Array.isArray(avatar)) {
  await avatar.store("avatars", { disk: "public" });
}
```

Confirm the disk in your filesystem configuration before you rely on `"public"`.
