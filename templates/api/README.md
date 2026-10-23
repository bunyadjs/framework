# API starter

JSON API with bearer tokens. Database, events, cache, log, HTTP, the token guard, mail, filesystems, dump, queues, notifications, broadcasting, and feature flags are the providers that boot.

Session, views, the document head, live components, and Inertia are not registered.

## Create an app

```bash
bunyad new api my-api
# or, without the global CLI:
bun create bunyad my-api --kit=api
cd my-api
bun install
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`. In an existing app, run `bunyad key:generate`.


## Routes

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| GET | `/` | banner (`{ "name": … }`) | — |
| POST | `/api/register` | `routes/(api)/register/RegisterController` — create user, return token (201) | — |
| POST | `/api/token` | `routes/(api)/token/TokenController.store` — credentials → token | — |
| GET | `/api/me` | `routes/(api)/me/UserController.show` | Bearer |
| DELETE | `/api/token` | `routes/(api)/token/TokenController.destroy` — revoke (204) | Bearer |

The folders are the URLs. `routes/(api)/` adds the `/api` prefix and the `api` middleware through `api.routes.ts`; models, providers and resources are in `app/`, and `server.ts` boots the app in one call.

Validation and bad credentials answer `422` with `{ message, errors }`. A missing or bad token answers `401` JSON, with or without an `Accept` header.

`POST /api/register` is limited to 10 per hour per IP. `POST /api/token` allows 5 failed attempts per minute per email and IP. Successful requests are not counted, and a blocked client gets `429` even with the right password. The `token` limiter lives in `AppServiceProvider`.

Tokens carry abilities and an optional expiry (`user.createToken("cli", ["posts:read"], expiresAt)`). Guard routes with `Route.middleware("abilities:posts:read")`. `user.tokens().delete()` signs a user out everywhere.

`bunyad db:seed` runs `database/seeders/DatabaseSeeder.ts`, which creates `test@example.com` (password `password`).

## Test

```bash
bun test
```
