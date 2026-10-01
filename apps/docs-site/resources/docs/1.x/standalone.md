---
title: Using Packages Alone
description: Depend on individual @bunyad/* packages in a plain Bun project without the full application skeleton.
---

# Using Packages Alone

## Introduction

Every Bunyad capability ships as its own `@bunyad/*` package. A starter kit pulls many of them together. You can also install one package at a time in a plain Bun project — routing without views, validation without a session, a cache without an ORM.

This page shows how to depend on packages outside a generated app, then walks through a complete [router](/docs/1.x/routing) example on `Bun.serve`. Feature chapters (database, cache, mail, …) assume a booted app by default; each notes when a package works alone.

## Adding a package

Packages live under the Bunyad monorepo today (`packages/router`, `packages/http`, …). Until they are published to a registry, point your app at a local path or symlink.

### File dependency

```json title="package.json"
{
  "type": "module",
  "dependencies": {
    "@bunyad/router": "file:../Bunyad/packages/router",
    "@bunyad/http": "file:../Bunyad/packages/http"
  }
}
```

Adjust the relative path to your Bunyad checkout, then run `bun install`.

### Workspace (inside the Bunyad repo)

```json
{
  "dependencies": {
    "@bunyad/router": "workspace:*",
    "@bunyad/http": "workspace:*"
  }
}
```

### What each package needs

| Package | Typical partners | Full app required? |
|---------|------------------|--------------------|
| `@bunyad/router` | `@bunyad/http` | No — match routes yourself or use a tiny kernel |
| `@bunyad/http` | — | No — `Request`, `json`, middleware helpers |
| `@bunyad/validation` | — | No — `validate()` on plain objects |
| `@bunyad/cache` | optional Redis / DB | No — call `Cache` / `setCache` in a script |
| `@bunyad/database` | — | No — `connectSqlite()` / `DB` without providers |
| `@bunyad/orm` | `@bunyad/database` | No — set a connection on `Model` |
| `@bunyad/mail` | — | No — configure a mailer and `Mail.send` |
| `@bunyad/events` | — | No — `new Dispatcher()` for scripts |
| `@bunyad/auth` | session / tokens as needed | Usually yes for web guards; token helpers usable alone |
| `@bunyad/view` / `@bunyad/session` | HTTP + app paths | Prefer a starter; possible alone with more wiring |
| `@bunyad/framework` | everything | Yes — providers, discovery, `createFetchHandler` |

Import from the package you installed. Prefer `@bunyad/router` over `@bunyad/framework` when you only need routes.

## Router on Bun.serve

Create a file, install `@bunyad/router` and `@bunyad/http`, and run it with Bun. No `bootstrap/`, no `config/`, no service providers.

```ts title="server.ts"
import { Router } from "@bunyad/router";
import { Request, json } from "@bunyad/http";

const router = new Router();

router.get("/", () => json({ message: "Hello from Bunyad" }));

router.get("/hello/{name}", (req: Request) =>
  json({ hello: req.route("name") }),
);

router.post("/echo", async (req: Request) => {
  const body = await req.json();
  return json({ received: body });
});

function toResponse(result: unknown): Response {
  if (result instanceof Response) return result;
  if (typeof result === "string") {
    return new Response(result, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return json(result as Record<string, unknown>);
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    const path = new URL(req.url).pathname.replace(/\/$/, "") || "/";
    const hit = router.match(req.method, path);
    if (!hit) {
      return new Response("Not Found", { status: 404 });
    }

    const action = hit.route.action;
    if (typeof action !== "function") {
      return new Response("Use closure actions in standalone mode", {
        status: 500,
      });
    }

    const request = new Request(req, hit.params);
    return toResponse(await action(request));
  },
});

console.log(`Listening on http://localhost:${process.env.PORT ?? 3000}`);
```

```shell
bun server.ts
curl http://localhost:3000/hello/ada
```

What this example uses:

- `Router` / `router.match` from `@bunyad/router`
- `Request` and `json` from `@bunyad/http`
- Closure actions only — `[Controller, "method"]` needs the HTTP kernel and container

Named routes, groups, prefixes, and middleware stacks still work on a bare `Router`. Controller injection, Form Requests, and global middleware groups need `@bunyad/core`'s `Application` + `createFetchHandler`.

### When you want the kernel

If you need middleware pipelines, controller DI, or exception rendering, boot a minimal application instead of hand-rolling `fetch`:

```ts
import { Application, createFetchHandler } from "@bunyad/core";
import { json } from "@bunyad/http";

const app = new Application(import.meta.dir);
app.router.get("/", () => json({ ok: true }));

Bun.serve({
  port: 3000,
  fetch: createFetchHandler(app),
});
```

That path is still far smaller than a full starter. See [request lifecycle](/docs/1.x/lifecycle) for what the kernel adds.

## Other packages alone

### Validation

```ts
import { validate, ValidationException } from "@bunyad/validation";

try {
  const data = await validate(
    { email: "ada@example.com" },
    { email: "required|email" },
  );
  console.log(data.email);
} catch (error) {
  if (error instanceof ValidationException) {
    console.error(error.errors);
  }
}
```

### Cache

```ts
import { Cache, CacheRepository, MemoryCacheStore, setCache } from "@bunyad/cache";

setCache(new CacheRepository(new MemoryCacheStore()));
await Cache.put("greeting", "hello", 60);
console.log(await Cache.get("greeting"));
```

See [Cache](/docs/1.x/cache) for file, Redis, and database stores.

### Database

```ts
import { connectSqlite, DB, setDefaultConnection } from "@bunyad/database";

const connection = connectSqlite(":memory:");
setDefaultConnection(connection);
await connection.run(
  "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)",
);
await DB.insert("INSERT INTO users (name) VALUES (?)", ["Ada"]);
const rows = await DB.select("SELECT * FROM users");
```

### ORM

Install `@bunyad/orm` and `@bunyad/database`. Open a connection, point every model at it with `Model.setConnection`, then query as usual — no providers, no `config/database.ts`.

For NestJS, Next.js, Express, Hono/Elysia, and Bun.serve recipes (plus optional Node peers), see [using the ORM outside Bunyad](/docs/1.x/orm-outside).

```json title="package.json"
{
  "type": "module",
  "dependencies": {
    "@bunyad/orm": "file:../Bunyad/packages/orm",
    "@bunyad/database": "file:../Bunyad/packages/database"
  }
}
```

```ts title="models.ts"
import { connectSqlite, schemaFor } from "@bunyad/database";
import { Model, type OrmCollection } from "@bunyad/orm";

const connection = connectSqlite("app.sqlite");
Model.setConnection(connection);

await schemaFor(connection).create("users", (table) => {
  table.id();
  table.string("email").unique();
  table.string("name");
  table.timestamps();
});

await schemaFor(connection).create("posts", (table) => {
  table.id();
  table.integer("user_id");
  table.string("title");
  table.timestamps();
});

class User extends Model {
  declare id: number;
  declare email: string;
  declare name: string;
  declare posts: OrmCollection<Post>;

  static table = "users";
  static fillable = ["email", "name"] as const;

  static relations = {
    posts: (m: User) => m.hasMany(Post),
  };
}

class Post extends Model {
  declare id: number;
  declare user_id: number;
  declare title: string;
  declare user: User | null;

  static table = "posts";
  static fillable = ["user_id", "title"] as const;

  static relations = {
    user: (m: Post) => m.belongsTo(User),
  };
}

const ada = await User.create({
  email: "ada@example.com",
  name: "Ada",
});

await ada.related("posts").create({ title: "Notes on analysis" });

const users = await User.where("email", "ada@example.com")
  .with("posts")
  .get();

console.log(users[0]?.name, users[0]?.posts.length);

const post = await Post.with("user")
  .where("title", "Notes on analysis")
  .first();
console.log(post?.user?.email);

await connection.close();
```

What this example uses:

- `connectSqlite` / `schemaFor` from `@bunyad/database` (swap in Postgres via the database package when you need it)
- `Model.setConnection(connection)` so all models share that connection
- The same `create` / `where` / `with` / relation APIs as in a full app

You can keep models in their own files and import them from scripts, CLI tools, or workers. Migrations, factories, and named multi-connection configs still prefer a starter app — see [ORM](/docs/1.x/orm) and [migrations](/docs/1.x/migrations).


## Growing into a full app

When one package is no longer enough:

1. Generate a starter with `bunyad new` ([installation](/docs/1.x/installation)).
2. Move your route closures into `routes/web.ts` or `routes/api.ts`.
3. Register providers and config the usual way ([service providers](/docs/1.x/providers)).

Your existing `@bunyad/router` imports keep working inside the app — the façade `Route` and `loadRouteModule` sit on the same package.
