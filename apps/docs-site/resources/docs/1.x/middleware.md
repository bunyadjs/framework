---
title: Middleware
description: Run code around a route with global middleware, groups, aliases, and route assignments.
---

# Middleware

## Introduction

Middleware wraps a route. Sessions, CSRF checks, authentication, and rate limits are middleware. The route action runs only when the middleware calls the next handler. Return a response of your own to stop the pipeline.

## Defining middleware

A middleware is a function, or a class with a `handle` method. Both receive the request and `next`.

```ts
import type { Middleware, Request } from "@bunyad/http";

const stamp: Middleware = async (request, next) => {
  const response = await next();
  response.headers.set("X-App", "bunyad");
  return response;
};
```

Generate a class with the CLI:

```shell
bunyad make:middleware EnsureToken
```

That writes `app/Http/Middleware/EnsureToken.ts`:

```ts title="app/Http/Middleware/EnsureToken.ts"
import type { Next } from "@bunyad/contracts";
import type { Request } from "@bunyad/http";

export default class EnsureToken {
  async handle(request: Request, next: Next) {
    if (!request.header("authorization")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return next();
  }
}
```

Pass an instance where a route or a group expects middleware: `new EnsureToken()`.

Middleware may change the response on the way out, as `stamp` does, because `next` resolves to the response from the rest of the pipeline.

## Registering middleware

### Global middleware

Global middleware runs on every request, before route middleware. Replace the list with `app.middleware`:

```ts
app.middleware([stamp]);
```

Prefer a named group when only some routes need the behavior. The web starter kits do not put the session on the global list. They put it in the `web` group.

### Assigning middleware to routes

Chain `middleware` on a route, or wrap several routes in `Route.middleware(...).group`.

```ts
Route.get("/dashboard", [AuthController, "dashboard"]).middleware(auth());

Route.middleware("web").group(() => {
  Route.get("/", [WelcomeController, "index"]);
});
```

A string names a group or an alias. A function or an instance is used as-is. Both work in the same route file: the starter kits use strings such as `"web"`, `"auth"`, `"verified"`, and `"throttle:6,1"`, and you can pass `auth()` or `throttle(5, 1)` instances wherever options are easier to read in code.

### Middleware groups

`middlewareGroup` stores a stack under a name. Routes mention the name. The kernel expands it when the request is handled.

```ts title="bootstrap/middleware.ts"
import type { Application } from "@bunyad/core";
import { verifyCsrf } from "@bunyad/auth";
import { startSession } from "@bunyad/session";

export function registerMiddleware(app: Application): void {
  app.middlewareGroup("web", [startSession(), verifyCsrf()]);
  app.middlewareGroup("api", []);
}
```

`web` is the session and the CSRF check. `api` is empty so token routes stay stateless. Add to a group by passing a new array, or by reading the current group and appending:

```ts
const current = app.getMiddlewareGroup("web") ?? [];
app.middlewareGroup("web", [...current, stamp]);
```

Groups nest. An outer `Route.middleware("web").group` wraps the routes declared inside it, including an inner `Route.middleware(auth()).group`.

### Middleware aliases

`routeMiddleware` gives a middleware a short name so route files can mention the name without importing the function.

```ts
app.routeMiddleware({
  auth: auth(),
});
```

```ts
Route.get("/dashboard", [AuthController, "dashboard"]).middleware("auth");
```

`throttle` is already aliased. `throttle:60,1` is sixty attempts per one minute. `throttle:auth` uses the named limiter `auth`. [Routing](/docs/1.x/routing) shows both forms on a group.

### Order

The kernel runs global middleware first, then the route stack from the outside in. A group on an outer `Route.middleware(...).group` wraps everything inside it. Nested groups wrap further. Middleware that must see the session, such as `auth`, belongs inside the `web` group, not outside it.

Aliases that appear on the same route can be reordered with a priority list. Listed names run relative to each other in list order; unlisted entries keep their relative positions:

```ts
Application.configure()
  .withMiddleware((middleware) => {
    middleware.priority(["session", "auth", "bindings"]);
    middleware.prependToPriorityList("bindings", "tenant");
    // → ["session", "auth", "tenant", "bindings"]
  })
  .create();
```

`appendToPriorityList(after, name)` inserts after an anchor the same way.

## Middleware parameters

`throttle` is the common case of a middleware that takes parameters. The first argument is a max number of attempts or the name of a limiter. The second is the decay window in minutes.

```ts
import { throttle } from "@bunyad/http";

Route.post("/login", [AuthController, "login"]).middleware(throttle(5, 1));
```

The alias form is the same idea as a string the kernel can resolve:

```ts
Route.post("/login", [AuthController, "login"]).middleware("throttle:5,1");
```

A custom class can take parameters from the alias string. Register it with `aliasMiddleware` and read the values after `next` on `handle`:

```ts
import { aliasMiddleware } from "@bunyad/http";

aliasMiddleware("role", () => ({
  async handle(request, next, role) {
    if (request.header("x-role") !== role) {
      return new Response("Forbidden", { status: 403 });
    }
    return next();
  },
}));

Route.get("/admin", [AdminController, "index"]).middleware("role:admin");
```

You can still pass constructor args when you attach an instance directly:

```ts
class EnsureRole {
  constructor(private role: string) {}

  async handle(request: Request, next: Next) {
    if (request.header("x-role") !== this.role) {
      return new Response("Forbidden", { status: 403 });
    }
    return next();
  }
}

Route.get("/admin", [AdminController, "index"]).middleware(new EnsureRole("admin"));
```

## Replacing the request

`next(request)` continues the pipeline with a different request. `next()` keeps the current one.

```ts
async handle(request: Request, next: Next) {
  request.merge({ locale: "en" });
  return next(request);
}
```

## Terminable middleware

Define `terminate(request, response)` to run after the response is produced (still before it is returned to the client):

```ts
export default class LogRequest {
  async handle(request: Request, next: Next) {
    return next();
  }

  async terminate(request: Request, response: Response) {
    console.log(request.method, request.path(), response.status);
  }
}
```

## Middleware priority

When a route lists several aliases and you need a fixed order (for example session before bindings), set a priority list in `withMiddleware`:

```ts
Application.configure()
  .withMiddleware((middleware) => {
    middleware.priority(["session", "bindings"]);
    middleware.prependToPriorityList("bindings", "auth");
  })
  .create();
```

`priority` replaces the list. `prependToPriorityList` / `appendToPriorityList` insert relative to an existing name. Aliases on the route that appear in the list are sorted into that order; other middleware keep their relative order.

## Controller middleware

Use the `@Middleware` decorator on a class or method, or extend `Controller` and register in the constructor:

```ts
import { Controller, json } from "@bunyad/http";

export default class PostController extends Controller {
  constructor() {
    super();
    this.middleware("auth").only("store", "update", "destroy");
    this.middleware("log").except("index");
  }

  index() {
    return json([]);
  }
}
```

`only` limits the middleware to those actions. `except` applies it everywhere except the listed actions. Method-level `@Middleware` and `@WithoutMiddleware` still work.
