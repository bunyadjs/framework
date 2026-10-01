---
title: CSRF Protection
description: Require a session token on state-changing requests, with an origin check first.
---

# CSRF Protection

## Introduction

A cross-site request forgery sends a command to your app from another site, using the visitor's cookies. A page you do not control can host a form that posts to a route such as `/user/email`. If that route trusts the cookie alone, the visitor's email changes when they load the other page.

```html
<form action="https://your-application.com/user/email" method="POST">
  <input type="email" name="email" value="malicious@example.com">
</form>
<script>
  document.forms[0].submit();
</script>
```

`POST`, `PUT`, `PATCH`, and `DELETE` must carry a secret that lives in the visitor's session. The other site cannot read that session, so it cannot forge the secret.

## Preventing CSRF requests

`preventRequestForgery` from `@bunyad/auth` is the middleware. `verifyCsrf` is the same function. The web starter kits put it in the `web` group, after `startSession` (`verifyCsrf` there):

```ts title="bootstrap/middleware.ts"
import { preventRequestForgery } from "@bunyad/auth";
import { handleUrl } from "@bunyad/router";
import { startSession } from "@bunyad/session";

app.middlewareGroup("web", [startSession(), handleUrl(), preventRequestForgery()]);
```

The check has two steps.

1. If `Sec-Fetch-Site` is `same-origin`, the request is allowed and the token is not read.
2. Otherwise the middleware compares the session token with the token on the request.

`GET`, `HEAD`, and `OPTIONS` are not checked. A request that already has a bearer token is not checked. When there is no session, the middleware does nothing.

The session stores the token at `_token`. A new session creates one. Read it from the session or from `csrf_token()`, which uses the current request:

```ts
Route.get("/token", (request) => {
  const fromSession = request.session?.token();
  const fromHelper = csrf_token();
  return fromSession ?? fromHelper;
});
```

`csrf_token()` throws when the request has no session. `regenerate()` on the session replaces the token. `regenerateToken()` replaces it without rotating the session id.

Every HTML form that changes state needs the token in a hidden field. The route that rendered the form must be in the `web` group.

```html
<form method="POST" action="/profile">
  <input type="hidden" name="_token" value="{{ csrf_token() }}">
</form>
```

### Origin verification

`same-origin` skips the token. A missing `Sec-Fetch-Site` header does not count as same-origin, so the token is required. Browsers send that header on secure requests. On plain HTTP the header is often absent and the token check runs.

`originOnly: true` refuses the token fallback. A request that is not same-origin gets 403 and `{ "message": "Origin mismatch." }`.

```ts
preventRequestForgery({ originOnly: true });
```

`allowSameSite: true` treats `Sec-Fetch-Site: same-site` like `same-origin`. Use it when a subdomain should call this host without a token.

```ts
preventRequestForgery({ allowSameSite: true });
```

## Excluding URIs

A webhook from another service will not have the session token. Prefer leaving that route out of the `web` group. When it has to stay in the group, name it in `except` or `exceptPrefixes`.

```ts
preventRequestForgery({
  except: ["/stripe/webhook", "stripe/*"],
  exceptPrefixes: ["/api"],
});
```

`except` matches the pathname exactly, or with `*` wildcards (`stripe/*` skips `/stripe/webhook` and deeper paths). Paths may be written with or without a leading slash. `exceptPrefixes` skips that path and every path under it, so `/api` skips `/api` and `/api/users`. The token is still created for those requests. They are only skipped at check time.

## X-CSRF-TOKEN

The middleware also accepts the token in the `X-CSRF-TOKEN` header. A page can print it in a meta tag and send it with each script request:

```html
<meta name="csrf-token" content="{{ csrf_token() }}">
```

```js
fetch("/profile", {
  method: "POST",
  headers: {
    "X-CSRF-TOKEN": document.querySelector('meta[name="csrf-token"]').content,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ name: "Ada" }),
});
```

After the middleware runs, the response includes `X-CSRF-TOKEN` set to the session token.

A mismatch is HTTP 419 and `{ "message": "CSRF token mismatch." }`.

## XSRF-TOKEN cookie

Each response also sets an encrypted `XSRF-TOKEN` cookie (AES via `APP_KEY`). JavaScript frameworks such as Axios read that cookie and send it back as `X-XSRF-TOKEN`. The middleware decrypts that header before comparing it to the session token. The cookie is not `HttpOnly` so scripts can read it; Prefer `X-CSRF-TOKEN` from a meta tag when you control the page.

## Testing

When `APP_ENV` is `testing`, verification is skipped by default so feature tests do not need to forge tokens. The middleware still issues the token header and cookie. Pass `enableDuringTesting: true` when a test must exercise the check:

```ts
preventRequestForgery({ enableDuringTesting: true });
```
