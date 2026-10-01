---
title: Authentication
description: Sign users in with the session guard, protect routes, issue API tokens, and hash passwords.
---

# Authentication

## Introduction

Most apps need a signed-in user. `@bunyad/auth` gives you a session guard for browsers, a token guard for APIs, password hashing, remember-me cookies, and middleware to keep guests out of private routes.

At the center is the `Auth` façade. Call `Auth()` for the default session guard (`web`). Call `Auth.guard("token")` for personal access tokens. Both resolve users through callbacks you register when you construct the guard — typically `User.find` and `User.where("email", …)`.

Browser login stores the user id in the session and sets `request.user`. API clients send `Authorization: Bearer {id}|{secret}` (or a first-party SPA cookie). State-changing browser forms still need CSRF protection; see [CSRF Protection](/docs/1.x/csrf).

To ask for a code from an authenticator app after the password, see [Two-Factor Authentication](/docs/1.x/two-factor).

`AuthServiceProvider` loads the user model on boot and registers a session guard. If `app/Models/PersonalAccessToken.ts` exists, it also registers the token guard. Publish `config/auth.ts` for defaults, named guard aliases, and `password_timeout`.

The user model is named by the provider behind the default guard. `driver` is always `orm` (users are `@bunyad/orm` models), and `model` is a class under `app/Models`:

```ts title="config/auth.ts"
export default {
  defaults: { guard: "web" },
  guards: {
    web: { driver: "session", provider: "users" },
  },
  providers: {
    users: { driver: "orm", model: "User" }, // app/Models/User.ts
  },
};
```

Without a `providers` entry the model is `User`. Any other `driver` stops the app at boot with `BUNYAD_AUTH_001`.

## Preparing your user model

Your user model should implement `Authenticatable` and store a hashed password. Compose `Authorizable` when you use gates and policies:

```ts title="app/Models/User.ts"
import type { Authenticatable } from "@bunyad/auth";
import { Authorizable } from "@bunyad/auth";
import { Model } from "@bunyad/orm";

export default class User extends Authorizable(Model) implements Authenticatable {
  declare name: string;
  declare email: string;
  declare password?: string;
  declare remember_token?: string | null;

  static table = "users";
  static hidden = ["password", "remember_token"];
}
```

Keep the password column long enough for bcrypt (at least 60 characters). Add a nullable `remember_token` string column if you use "remember me".

Register users with `Hash.make` — never store plain text:

```ts
import { Hash } from "@bunyad/auth";
import User from "@/Models/User.ts";

const user = await User.create({
  name: "Ada",
  email: "ada@example.com",
  password: await Hash.make("secret"),
});
```

## Retrieving the authenticated user

Inside a controller or route that already ran the session middleware:

```ts
import type { Request } from "@bunyad/http";
import { Auth } from "@bunyad/auth";

export default class DashboardController {
  async show(request: Request) {
    const user = await Auth().user(request);
    const id = await Auth().id(request);

    if (await Auth().check(request)) {
      // Signed in…
    }

    if (await Auth().guest(request)) {
      // Not signed in…
    }
  }
}
```

After a successful login (or a remembered session), the same user is also on `request.user`.

`Auth.authenticate(request)` returns the user or aborts with 401:

```ts
const user = await Auth.authenticate(request);
```

## Protecting routes

### Requiring authentication

Attach the `auth` middleware so only signed-in users reach the route:

```ts title="routes/web.ts"
import { Route } from "@bunyad/router";
import DashboardController from "@/Http/Controllers/DashboardController.ts";

Route.middleware("web").group(() => {
  Route.get("/dashboard", [DashboardController, "show"])
    .middleware("auth")
    .name("dashboard");
});
```

Or build the middleware with options:

```ts
import { auth } from "@bunyad/auth";

Route.get("/dashboard", [DashboardController, "show"]).middleware(
  auth({ loginPath: "/login" }),
);
```

Unauthenticated HTML and Inertia requests redirect to `loginPath` (default `/login`). The requested URL is stored as `url.intended` on the session so you can send the user back after login with `redirect().intended()`. Clients that prefer `application/json` receive `401` with `{ "message": "Unauthenticated." }` (intended URL is still stored when a session is present).

Use the token guard for API routes:

```ts
Route.get("/api/me", [ApiTokenController, "me"]).middleware("auth:token");
```

### Guests only

Login and register pages should reject users who are already signed in:

```ts
Route.get("/login", [AuthController, "showLogin"]).middleware("guest");
```

Authenticated visitors redirect to `homePath` (default `/dashboard`). Override with `guest({ homePath: "/panel" })`.

## Manually authenticating users

### Attempting credentials

`Auth.attempt` validates the password and starts a session on success. Pass the request first, then email and password, or a credentials object:

```ts title="app/Http/Controllers/AuthController.ts"
import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Auth } from "@bunyad/auth";

export default class AuthController {
  async login(request: Request) {
    const email = String(request.input("email") ?? "");
    const password = String(request.input("password") ?? "");

    const ok = await Auth.attempt(request, email, password);

    if (!ok) {
      request.session?.flash("error", "Invalid credentials.");
      return redirect("/login");
    }

    return redirect().intended("/dashboard");
  }
}
```

```ts
await Auth.attempt(request, { email, password });
await Auth.attempt(request, { email, password }, true); // remember me
```

On success, the guard regenerates the session id before storing the login key, so you do not need a separate fixation step. When `Hash.needsRehash` is true for the stored hash, `attempt` / `attemptWhen` rehash the password and call `updatePassword` if the guard was configured with that callback.

`redirect().intended("/dashboard")` sends the user to the URL stored by the `auth` middleware (`url.intended`), or to `/dashboard` when none is set.

`Auth.validate(credentials)` checks the password without writing the session. `Auth.getLastAttempted()` returns the user row from the last validate or attempt.

### Extra checks before login

Use `attemptWhen` when credentials alone are not enough:

```ts
const ok = await Auth.attemptWhen(
  request,
  { email, password },
  (user) => user.email !== "banned@example.com",
);
```

Pass an array of callbacks when every check must pass.

### Logging in a known user

```ts
await Auth.login(request, user);
await Auth.login(request, user, true); // remember me

await Auth.loginUsingId(request, 1);
await Auth.loginUsingId(request, 1, true);
```

### One request only

`once` and `onceUsingId` authenticate for the current request without writing the session login key:

```ts
await Auth.once(request, { email, password });
await Auth.onceUsingId(request, 1);
```

`setUser` / `forgetUser` set or clear the request-scoped user the same way.

## Remembering users

Pass `true` as the remember flag to `attempt`, `login`, or `loginUsingId`. The guard stores a SHA-256 digest of a random secret on the user (`remember_token`) and queues a cookie whose value is `{id}|{plaintextSecret}`.

Wire `updateRememberToken` when you construct the session guard so the digest persists:

```ts
import { SessionGuard, setAuthGuard } from "@bunyad/auth";
import User from "@/Models/User.ts";

setAuthGuard(
  new SessionGuard({
    retrieveById: (id) => User.find(id),
    retrieveByCredentials: (email) => User.where("email", email).first(),
    updateRememberToken: async (user, token) => {
      const row = await User.find(user.id);
      if (row) {
        row.remember_token = token;
        await row.save();
      }
    },
  }),
);
```

After login or logout, attach the pending `Set-Cookie` with `appendRememberCookie`:

```ts
import { Auth, appendRememberCookie } from "@bunyad/auth";
import { redirect } from "@bunyad/http";

const ok = await Auth.attempt(request, { email, password }, true);
const response = redirect(ok ? "/dashboard" : "/login");
return appendRememberCookie(response, Auth(), { request });
```

On a later visit, if the session has no login id, the guard reads the remember cookie, verifies the secret against the stored digest, restores the session, and sets `viaRemember()` to `true`. Cookie defaults: name `remember_web`, lifetime about 400 days, `HttpOnly`, `SameSite=Lax`, and `Secure` in production or on HTTPS.

## HTTP Basic Authentication

`Auth.basic(request)` tries session login from an `Authorization: Basic` header. On failure it returns a 401 response with a `WWW-Authenticate` challenge; on success it returns `null` so your middleware can continue:

```ts
const challenge = await Auth.basic(request);
if (challenge) return challenge;
```

`Auth.onceBasic(request)` authenticates for this request only. `Auth.attemptBasic` and `Auth.basicCredentials` are available when you need the pieces separately. Pass a field name (default `"email"`) when the Basic username maps to another column.

## Logging out

```ts
await Auth.logout(request);
return appendRememberCookie(redirect("/login"), Auth(), { request });
```

`logout` clears the remember token (when `updateRememberToken` is set), forgets the session login key, and invalidates the session so the old cookie cannot be reused.

`logoutCurrentDevice` clears this device's session data without cycling the remember token. `logoutOtherDevices(request, password)` rehashes the password (via `updatePassword` when provided), rotates the remember token, and returns the user — or `false` if the password is wrong:

```ts
setAuthGuard(
  new SessionGuard({
    retrieveById: (id) => User.find(id),
    retrieveByCredentials: (email) => User.where("email", email).first(),
    updateRememberToken: async (user, token) => {
      /* persist */
    },
    updatePassword: async (user, hashed) => {
      const row = await User.find(user.id);
      if (row) {
        row.password = hashed;
        await row.save();
      }
    },
  }),
);

const user = await Auth.logoutOtherDevices(request, currentPassword);
```

## API tokens

The `token` guard issues personal access tokens of the form `{id}|{secret}`. Only the SHA-256 hash of the secret is stored. Clients send the plain token as a bearer:

```http
Authorization: Bearer 1|a1b2c3…
```

### Issuing a token

```ts title="app/Http/Controllers/ApiTokenController.ts"
import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";
import { Auth, Hash } from "@bunyad/auth";
import User from "@/Models/User.ts";

export default class ApiTokenController {
  async store(request: Request) {
    const email = String(request.input("email") ?? "");
    const password = String(request.input("password") ?? "");

    const user = await User.where("email", email).first();
    if (!user?.password || !(await Hash.check(password, String(user.password)))) {
      return json({ message: "Invalid credentials." }, 401);
    }

    const token = await Auth.guard("token").createToken(user, "api", {
      abilities: ["posts:read", "posts:write"],
      expiresAt: 60 * 24 * 7, // minutes from now
    });
    return json({ token, token_type: "Bearer" });
  }
}
```

Protect routes with `auth:token`, then read the user:

```ts
const user = await Auth.guard("token").user(request);
await Auth.guard("token").authenticate(request);
Auth.guard("token").tokenCan("posts:read");
```

Compose `HasApiTokens` on the user model for `user.createToken(...)` / `tokenCan` helpers.

### Revoking a token

```ts
await Auth.guard("token").revoke(request);
// or
await Auth.guard("token").logout(request);
```

`currentAccessToken()` returns the row used for this request. `getTokenForRequest` reads the bearer string. `validate({ token })` checks a token without attaching it to the request.

Register the guard yourself with `TokenGuard` and `setTokenGuard`, or use `tokenGuardUsing` from `@bunyad/framework` with a `PersonalAccessToken` model (as the API starter does).

## Password hashing

`Hash` from `@bunyad/auth` hashes and verifies passwords with bcrypt by default (Argon2id is available):

```ts
import { Hash } from "@bunyad/auth";

const hashed = await Hash.make("secret");
await Hash.check("secret", hashed); // true
Hash.needsRehash(hashed);
Hash.isHashed(hashed);
Hash.info(hashed);
Hash.setRounds(12);
```

Use `Hash.make` when registering or resetting a password. The session guard calls `Hash.check` during `attempt` and `validate`.

## JSON Web Tokens

`Jwt.encode` / `Jwt.decode` sign and verify HS256 tokens. This is a crypto helper — not a guard. Use it when you need a signed payload of your own:

```ts
import { Jwt } from "@bunyad/auth";

const token = Jwt.encode({ sub: String(user.id), exp: Math.floor(Date.now() / 1000) + 3600 }, process.env.APP_KEY!);
const payload = Jwt.decode<{ sub: string }>(token, process.env.APP_KEY!);
```

`decode` rejects a bad signature and an expired `exp` claim.

## Password confirmation

Use the `password.confirm` middleware (or `confirmPassword()`) on sensitive routes. After the user confirms, call `markPasswordConfirmed(request)` or `confirmPasswordFor(request, password)`. Timeout comes from `config/auth.ts` `password_timeout` (default 3 hours).

## Login throttling

Register the named limiter once (AuthServiceProvider does this):

```ts
import { throttle } from "@bunyad/http";

router.post("/login", [throttle("login"), LoginController]);
```

The `login` limiter allows 5 attempts per minute keyed by `email|ip` (`loginThrottleKey`).

## Custom guards and events

```ts
Auth.extend("admin", () => Auth());
Auth.viaRequest("header", (request) => /* user or null */);

Event.listen(Login, (e) => { /* … */ });
Event.listen(Failed, (e) => { /* … */ });
Event.listen(Logout, (e) => { /* … */ });
```

Set guest / signed-in redirects on the application builder or middleware configurator:

```ts
Application.configure(basePath)
  .redirectGuestsTo("/login")
  .redirectUsersTo("/dashboard")
  // …
```

## Guard helpers

| Method | Role |
| --- | --- |
| `Auth()` / `Auth.guard("web")` | Default session guard |
| `Auth.guard("token")` | Token guard |
| `check` / `guest` | Authenticated or not |
| `user` / `getUser` / `id` | Current user |
| `viaRemember` | Login restored from remember cookie |
| `hasUser` | User already resolved on this request |
| `getName` / `getRecallerName` | Session key / remember cookie name |
| `setRememberDuration(minutes)` | Remember cookie lifetime |

Override the default guards in a service provider with `setAuthGuard` and `setTokenGuard` when discovery is not enough.
