# API starter (classic layout)

JSON API with bearer tokens. Database, events, cache, log, HTTP, the token guard, mail, filesystems, dump, queues, notifications, broadcasting, and feature flags are the providers that boot.

Session, views, the document head, live components, and Inertia are not registered.

## Create an app

```bash
bunyad new api my-api --structure=classic
cd my-api
bun install
bun run dev
```

`bunyad new` copies `.env.example` to `.env` and sets `APP_KEY`. In an existing app, run `bunyad key:generate`.


## Where things are

```text
app/Http/Controllers/   controllers (`Auth/` for register and token)
app/Http/Requests/      form requests
app/Http/Resources/     JSON resources
routes/web.ts           `/`, the banner
routes/api.ts           the API: wrapped in the `api` middleware group and the `/api` prefix for you
```

## Routes

| Method | Path | Handler | Auth |
|--------|------|---------|------|
| GET | `/` | `HomeController` (`{ "name": … }`) | — |
| POST | `/api/register` | `Auth/RegisterController` — create user, return token (201) | — |
| POST | `/api/token` | `Auth/TokenController.store` — credentials → token | — |
| GET | `/api/me` | `UserController.show` | Bearer |
| DELETE | `/api/token` | `Auth/TokenController.destroy` — revoke (204) | Bearer |

The Folders layout puts each controller beside its form request in `routes/(api)/…`; both are supported, and `make:controller` follows whichever your app uses (`bunyad.json`).
