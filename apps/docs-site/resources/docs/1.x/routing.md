---
title: Routing
description: Define HTTP routes, parameters, groups, model binding, fallbacks, and rate limits.
---

# Routing

The most basic routes accept a URI and a function. That is enough to answer a request without a controller class.

```ts title="routes/web.ts"
import { Route } from "@bunyad/router";

export default function (): void {
  Route.get("/greeting", () => "Hello World");
}
```

The file exports a function. Bootstrap loads it once, while the application boots, and the `Route` façade registers each call on the application router.

To use `@bunyad/router` in a plain Bun script with `Bun.serve` and no application skeleton, see [using packages alone](/docs/1.x/standalone).

## Using the router alone

A `Router` instance works without providers or `routes/*.ts`. Register closures, match the method and path, wrap the Fetch request, and return the action result:

```ts title="server.ts"
import { Router } from "@bunyad/router";
import { Request, json } from "@bunyad/http";

const router = new Router();
router.get("/", () => json({ ok: true }));
router.get("/users/{id}", (req: Request) => json({ id: req.route("id") }));

Bun.serve({
  port: 3000,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const hit = router.match(req.method, path);
    if (!hit) return new Response("Not Found", { status: 404 });
    const action = hit.route.action;
    if (typeof action !== "function") {
      return new Response("Closure actions only", { status: 500 });
    }
    return await action(new Request(req, hit.params));
  },
});
```

Groups, prefixes, named routes, and middleware registered on that `Router` still apply. Controllers with constructor injection need `Application` and `createFetchHandler` — covered on the [standalone packages](/docs/1.x/standalone) page.

## Basic routing

### The default route files

Routes live in the `routes` directory. `bootstrap/app.ts` loads them with `loadRouteModule` after middleware groups are registered.

`routes/web.ts` is the web interface. Put those routes in the `web` middleware group so they receive a session and a CSRF check:

```ts title="routes/web.ts"
import { Route } from "@bunyad/router";
import WelcomeController from "@/Http/Controllers/WelcomeController.ts";

export default function (): void {
  Route.middleware("web").group(() => {
    Route.get("/", [WelcomeController, "index"]).name("home");
  });
}
```

Open the URL in the browser. A route registered as `/orders` is `http://localhost:3000/orders` when the app is served on port 3000.

#### API routes

`routes/api.ts` is for stateless endpoints. When that file is loaded (via `loadRouteModule`, `withRouting({ api })`, or `bunyad route:list`), the framework applies the `api` middleware group and an `/api` URI prefix. Define paths relative to that prefix:

```ts title="routes/api.ts"
import { Route } from "@bunyad/router";
import { json } from "@bunyad/http";

export default function (): void {
  Route.get("/user", () => json({ name: "Ada" }));
  // Served at GET /api/user
}
```

Pass `apiPrefix: false` to `loadRouteModule` (or an empty `apiPrefix` on `withRouting`) when you want the file as written with no automatic prefix. `bunyad route:list` reads both `routes/web.ts` and `routes/api.ts` when those files exist.

#### Available router methods

Register a route for one HTTP verb:

```ts
Route.get(uri, action);
Route.post(uri, action);
Route.put(uri, action);
Route.patch(uri, action);
Route.delete(uri, action);
Route.options(uri, action);
```

`Route.get` also answers `HEAD`.

`match` answers several verbs. `any` answers every verb:

```ts
Route.match(["get", "post"], "/orders", () => "ok");

Route.any("/fallback-verb", () => "ok");
```

When several routes share a URI, register `get`, `post`, `put`, `patch`, `delete`, and `options` before `any`, `match`, and `redirect`. The first matching route wins.

#### The request argument

Pass the current request by accepting it as the action’s first argument. The kernel builds that object from the incoming Fetch request.

```ts
import type { Request } from "@bunyad/http";

Route.get("/users", (request: Request) => {
  return request.string("q", "");
});
```

Constructor and method injection for other services is described in [controllers](/docs/1.x/controllers).

#### CSRF protection

HTML forms that `POST`, `PUT`, `PATCH`, or `DELETE` to a `web` route must send a CSRF token. The `web` group runs `verifyCsrf()`. A missing or wrong token is rejected. Use `@csrf` in a view, or `csrf_token()` from `@bunyad/auth`, for the hidden field. See [CSRF Protection](/docs/1.x/csrf).

#### Form method spoofing

HTML forms only support `GET` and `POST`. To hit a `PUT`, `PATCH`, or `DELETE` route from a form, post with a hidden `_method` field. The kernel reads `_method` on `POST` (and the `X-HTTP-Method-Override` header) before matching the route. `@method('PUT')` prints that field:

```html
<form method="POST" action="/profile">
  @csrf
  @method('PUT')
  <!-- ... -->
</form>
```

## Redirect routes

`Route.redirect` sends the client somewhere else without a controller. The default status is 302.

```ts
Route.redirect("/here", "/there");
Route.redirect("/here", "/there", 301);
```

`Route.permanentRedirect` is the 301 shortcut:

```ts
Route.permanentRedirect("/here", "/there");
```

## View routes

`Route.view` registers a `GET` route whose action returns HTML. Pass a render function, or a view name (with optional data) when the view renderer is registered (`ViewServiceProvider`):

```ts
Route.view("/welcome", () => "<h1>Welcome</h1>");

Route.view("/welcome", (request) => {
  return `<h1>Hello ${request.string("name", "there")}</h1>`;
});

Route.view("/welcome", "welcome", { name: "Ada" });
```

The named form calls `view(name, data)` from `@bunyad/view`. The optional status argument defaults to 200.

## Listing your routes

`bunyad route:list` prints the method, URI, name, and action for every route loaded from `routes/web.ts` and `routes/api.ts`.

```shell
bunyad route:list
```

Filter the table with the same flags the command accepts:

```shell
bunyad route:list --path=api
bunyad route:list --method=POST
bunyad route:list --name=home
bunyad route:list --json
```

## Routing customization

An application decides which files load. The web starter kits load `routes/web.ts` from `bootstrap/app.ts`, and `web.ts` calls `routes/auth.ts` and `routes/settings.ts` inside its `web` group:

```ts title="bootstrap/app.ts"
await loadRouteModule(app.basePath("routes/web.ts"), app.router);
```

Load another file the same way when a subset of routes should live apart from `web.ts`:

```ts
await loadRouteModule(app.basePath("routes/webhooks.ts"), app.router);
```

Inside that file, group the routes with the middleware, prefix, and name they should share:

```ts title="routes/webhooks.ts"
import { Route } from "@bunyad/router";

export default function (): void {
  Route.middleware("api")
    .prefix("webhooks")
    .name("webhooks.")
    .group(() => {
      Route.post("/stripe", () => "ok").name("stripe");
    });
}
```

The route name is `webhooks.stripe`. The path is `/webhooks/stripe`.

## Route parameters

### Required parameters

Wrap a segment in braces to capture it. The value is on the request under that name.

```ts
Route.get("/user/{id}", (request) => {
  return `User ${request.input("id")}`;
});
```

Capture as many segments as you need:

```ts
Route.get("/posts/{post}/comments/{comment}", (request) => {
  return {
    post: request.input("post"),
    comment: request.input("comment"),
  };
});
```

Parameter names are letters. Underscores are allowed. A parameter is a string until you cast it with `request.integer` or a constraint below.

### Optional parameters

Mark a trailing segment optional with `?`. The route matches when that segment is missing. Only trailing optional segments are allowed — a required segment may not follow an optional one.

```ts
Route.get("/users/{id}/{name?}", (request) => {
  return {
    id: request.input("id"),
    name: request.input("name"), // undefined when omitted
  };
});
```

`/users/9` and `/users/9/ada` both match. When you generate the URL, omit the optional key (or pass `undefined`) to drop the segment:

```ts
route("users.show", { id: 9 }); // /users/9
route("users.show", { id: 9, name: "ada" }); // /users/9/ada
```

### Regular expression constraints

`where` limits the shape of a parameter. A URI that fails the pattern does not match the route.

```ts
Route.get("/user/{name}", (request) => request.input("name")).where(
  "name",
  "[A-Za-z]+",
);

Route.get("/user/{id}", (request) => request.input("id")).where("id", "[0-9]+");

Route.get("/user/{id}/{name}", (request) => request.input("id")).where({
  id: "[0-9]+",
  name: "[a-z]+",
});
```

Helpers cover the patterns you will type most often:

```ts
Route.get("/user/{id}/{name}", (request) => request.input("id"))
  .whereNumber("id")
  .whereAlpha("name");

Route.get("/user/{name}", (request) => request.input("name")).whereAlphaNumeric(
  "name",
);

Route.get("/user/{id}", (request) => request.input("id")).whereUuid("id");

Route.get("/user/{id}", (request) => request.input("id")).whereUlid("id");
```

| Method              | Pattern            |
| ------------------- | ------------------ |
| `whereNumber`       | Digits             |
| `whereAlpha`        | Letters            |
| `whereAlphaNumeric` | Letters and digits |
| `whereUuid`         | UUID               |
| `whereUlid`         | ULID               |
| `whereIn`           | Allow-list         |

```ts
Route.get("/posts/{status}", handler).whereIn("status", ["draft", "live"]);
```

If you use the same constraint on many routes, call `Route.pattern` once at boot and every `{id}` uses it:

```ts
Route.pattern("id", "[0-9]+");
```

## Named routes

Chain `name` so the rest of the app can build the path without hard-coding it.

```ts
Route.get("/user/profile", (request) => "profile").name("profile");
```

```ts
import { route } from "@bunyad/router";

route("profile");
```

Pass parameters when the path has braces:

```ts
Route.get("/user/{id}", (request) => request.input("id")).name("user.show");

route("user.show", { id: 1 });
```

Names must be unique. A second `name("profile")` replaces the path stored for that name.

## Route groups

Groups share attributes across many routes: middleware, a URI prefix, a name prefix, or a domain. Groups can be nested. The outer group wraps the inner one.

### Middleware

`middleware` on a group runs for every route inside it. Pass a group name registered with `app.middlewareGroup`, or a middleware instance.

```ts
Route.middleware("web").group(() => {
  Route.get("/", () => "home");
  Route.get("/dashboard", () => "dashboard");
});
```

### Controllers

Point the route at a class and a method when the action is more than a closure. The tuple is `[Controller, "method"]`.

```ts
Route.get("/user", [UserController, "index"]);
```

### Subdomain routing

`domain` captures a host label. The captured value is a route parameter.

```ts
Route.domain("{account}.example.com").group(() => {
  Route.get("/", (request) => request.input("account"));
});
```

### Route prefixes

`prefix` is prepended to every URI in the group. A prefix of `admin` turns `/users` into `/admin/users`.

```ts
Route.prefix("admin").group(() => {
  Route.get("/users", () => "users");
});
```

### Route name prefixes

`name` on a group is prepended to each route name inside it, including the trailing dot you include in the prefix.

```ts
Route.name("admin.").group(() => {
  Route.get("/users", () => "users").name("users");
});
```

`route("admin.users")` builds `/users`. Combine `prefix` and `name` when the URI and the name should both be namespaced:

```ts
Route.prefix("admin")
  .name("admin.")
  .group(() => {
    Route.get("/users", () => "users").name("users");
  });
```

## Route model binding

A segment such as `{user}` is the id in the URL. Type the action argument as the model and the router loads that row and passes the instance in. A missing row is a 404.

### Implicit binding

The argument name or the type name has to match the segment. `User` matches `{user}`. Import the model as a value, not `import type`, so the class can be loaded. The class needs `find`, or `resolveRouteBinding`.

```ts
import User from "@/Models/User.ts";

Route.get("/users/{user}", (user: User) => user.name);
```

`GET /users/1` calls `User.find("1")` (or `resolveRouteBinding`) and the callback receives that instance. `user.name` is the column on the model, not the URL segment.

The same injection works on a controller method. The method parameter is the model:

```ts
import User from "@/Models/User.ts";

export default class UserController {
  show(user: User) {
    return user.name;
  }
}
```

```ts
Route.get("/users/{user}", [UserController, "show"]);
```

Take the request as well when you need both. Order follows the parameter list:

```ts
Route.get("/users/{user}", (request: Request, user: User) => {
  return user.name;
});
```

When the callback only receives the request, read the instance with `request.model`. `request.input("user")` and `request.route("user")` stay the raw segment string.

```ts
Route.model("user", User);

Route.get("/users/{user}", (request: Request) => {
  const user = request.model<User>("user");
  return user.name;
});
```

A model file at `app/Models/User.ts` is used for `{user}` when you have not called `Route.model`. An explicit `Route.model` wins over that file.

#### Custom missing responses

`missing` replaces the default 404 when a binder finds no model:

```ts
Route.get("/users/{user}", [UserController, "show"]).missing(() =>
  redirect("/users"),
);
```

#### Enum binding

A string enum (or `{ Key: "value" }` object) on a parameter resolves to that value or 404s:

```ts
const Category = { Fruits: "fruits", People: "people" } as const;

Route.enum("category", Category);
Route.get("/categories/{category}", (category: string) => category);
```

Type-hinting the enum on a closure or controller action also registers the binder when routes are scanned.

#### Soft deleted models

`withTrashed()` includes soft-deleted rows when the model implements `resolveSoftDeletableRouteBinding`.

```ts
Route.get("/users/{user}", (user: User) => user.name).withTrashed();
```

#### Customizing the key

Put the column in the segment when the lookup is not the primary key. The model resolves it through `resolveRouteBinding(value, field)`.

```ts
import Post from "@/Models/Post.ts";

Route.get("/posts/{post:slug}", (post: Post) => post.title);
```

Override `getRouteKeyName()` on the model when every route for that model should use the same column. A segment field such as `{post:slug}` still wins for that one route.

#### Scoped bindings

A child with its own column, such as `{post:slug}`, is looked up through the parent. The parent implements `resolveChildRouteBinding`. Call `scopeBindings()` when the child segment has no column and must still belong to the parent.

```ts
import Post from "@/Models/Post.ts";
import User from "@/Models/User.ts";

Route.get(
  "/users/{user}/posts/{post:slug}",
  (user: User, post: Post) => post.title,
);

Route.get(
  "/users/{user}/posts/{post}",
  (user: User, post: Post) => post.title,
).scopeBindings();
```

Scope every route in a group:

```ts
Route.scopeBindings().group(() => {
  Route.get(
    "/users/{user}/posts/{post}",
    (user: User, post: Post) => post.title,
  );
});
```

`withoutScopedBindings()` turns the check off for one route inside a group that enabled it.

### Explicit binding

`Route.model` registers the class for a parameter name. Put it next to the routes that use that name. A missing model is still a 404.

```ts
import User from "@/Models/User.ts";

Route.model("user", User);

Route.get("/users/{user}", (user: User) => user.name);
```

`Route.bind` replaces that lookup with a function. Return `null` and the response is 404.

```ts
Route.bind("user", (value) => {
  return { id: value, name: "Ada" };
});
```

`modelIfAbsent` registers a model only when that parameter does not already have a binder. It does not replace `Route.model` or `Route.bind`.

## Fallback routes

`Route.fallback` runs when nothing else matches. Register it after the real routes.

```ts
Route.fallback(() => "Not found");
```

The response status is still 200 unless the action returns another status. Throw `abort(404)` when the fallback should be a not-found response. See [error handling](/docs/1.x/errors).

## Rate limiting

`throttle` from `@bunyad/http` rejects a client that calls a route too often. The response is 429 with `Retry-After` and the rate-limit headers.

A number is the maximum attempts per decay window. The second argument is the window in minutes. The default window is one minute, and the default key is the client IP.

```ts
import { throttle } from "@bunyad/http";

Route.middleware(throttle(60, 1)).group(() => {
  Route.post("/login", () => "ok");
});
```

A string names a limiter you defined with `RateLimiter.for` from `@bunyad/http`:

```ts
Route.middleware(throttle("uploads")).group(() => {
  Route.post("/photos", [PhotoController, "store"]);
});
```

Named limiters are the right place for a key that is not the IP, such as the user id or the email in the body.

## Accessing the current route

Inside a request, the router remembers which route matched.

```ts
Route.current();
Route.currentRouteName();
Route.currentRouteNamed("home");
Route.currentRouteNamed("admin.*");
Route.currentRouteAction(); // "HomeController@index" or "Closure"
```

`currentRouteNamed` accepts more than one pattern. `is` is the same check. `has` reports whether a name is registered, which does not depend on the current request.

```ts
Route.has("home");
Route.getRoutes();
```

## CORS

Cross-origin browser requests need CORS headers. `HandleCors` is prepended on the global middleware stack when the app boots (`HttpServiceProvider`). Configure it in `config/cors.ts`:

```ts title="config/cors.ts"
export default {
  paths: ["api/*", "auth/csrf-cookie"],
  allowed_methods: ["*"],
  allowed_origins: ["*"],
  allowed_origins_patterns: [],
  allowed_headers: ["*"],
  exposed_headers: [],
  max_age: 0,
  supports_credentials: false,
};
```

Matching paths answer `OPTIONS` preflight with `204` and attach `Access-Control-*` headers on normal responses. Restrict `allowed_origins` in production instead of `*`. When `supports_credentials` is true, the reflected `Origin` is required (browsers reject `*` with credentials).
