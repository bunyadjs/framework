---
title: Controllers
description: Group related route actions in controller classes, including resource controllers.
---

# Controllers

## Introduction

Instead of defining all of your request handling as closures in the route file, you may organize this behavior into controller classes. Controllers live in `app/Http/Controllers`.

## Writing controllers

### Basic controllers

A controller is a class. Each method is an action. The method receives the request and returns a response, a string, a view, or a JSON value.

```ts title="app/Http/Controllers/UserController.ts"
import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";

export default class UserController {
  index(request: Request) {
    return json({ q: request.string("q", "") });
  }
}
```

Point the route at the class and the method:

```ts
import UserController from "@/Http/Controllers/UserController.ts";

Route.get("/users", [UserController, "index"]);
```

Generate the file with:

```shell
bunyad make:controller UserController
```

The kernel keeps one instance of the controller for the process and calls the method on each request.

Returning a `Response` sends that response as-is. A string is HTML. A plain object or a model is JSON. Values with `toJSON` are serialized.

### Single action controllers

When a controller does one thing, give it an `index` method and a single route. Bunyad does not invoke a class just because it has a method named a special way. The route tuple always names the method: `[ReportController, "index"]`.

## Controller middleware

Assign middleware on the route that points at the controller, or on the group that contains that route. The controller method does not declare the middleware itself.

```ts
Route.middleware("web").group(() => {
  Route.middleware(auth()).group(() => {
    Route.get("/dashboard", [AuthController, "dashboard"]);
  });
});
```

The `web` group starts the session. `auth()` then sees that session. Reverse the order and the authentication check runs before the session exists.

## Resource controllers

A resource controller handles the usual actions for a noun: list, create, store, show, edit, update, and destroy. `Route.resource` registers those routes for you.

```ts
Route.resource("photos", PhotoController);
```

| Verb | URI | Action | Name |
| --- | --- | --- | --- |
| GET | `/photos` | `index` | `photos.index` |
| GET | `/photos/create` | `create` | `photos.create` |
| POST | `/photos` | `store` | `photos.store` |
| GET | `/photos/{photo}` | `show` | `photos.show` |
| GET | `/photos/{photo}/edit` | `edit` | `photos.edit` |
| PUT/PATCH | `/photos/{photo}` | `update` | `photos.update` |
| DELETE | `/photos/{photo}` | `destroy` | `photos.destroy` |

`Route.apiResource` omits `create` and `edit`, which exist to return HTML forms.

```ts
Route.apiResource("photos", PhotoController);
```

### Singleton resources

A singleton has one instance (no `{id}` segment). Default actions are `show`, `edit`, and `update`. Chain `creatable()` / `destroyable()`, or pass those flags in options:

```ts
Route.singleton("profile", ProfileController).creatable().destroyable();

Route.apiSingleton("profile", ProfileController, { creatable: true });
```

| Verb | URI | Action |
| --- | --- | --- |
| GET | `/profile` | `show` |
| GET | `/profile/edit` | `edit` |
| PUT/PATCH | `/profile` | `update` |
| GET | `/profile/create` | `create` (creatable) |
| POST | `/profile` | `store` (creatable) |
| DELETE | `/profile` | `destroy` (destroyable) |

`apiSingleton` omits `create` and `edit`.

### Partial resource routes

`only` and `except` limit the actions.

```ts
Route.resource("photos", PhotoController, { only: ["index", "show"] });
Route.resource("photos", PhotoController, { except: ["destroy"] });
```

### Nested resources

Dot the name when the child belongs to a parent. The URI includes both parameters.

```ts
Route.resource("photos.comments", PhotoCommentController);
```

`shallow: true` drops the parent segment from the member routes (show, edit, update, destroy) and keeps it on the collection routes (index, create, store).

```ts
Route.resource("photos.comments", PhotoCommentController, { shallow: true });
```

### Naming resource routes

`names` replaces the generated names. Pass a string to prefix every name, or an object to rename individual actions.

```ts
Route.resource("photos", PhotoController, { names: "admin.photos" });
```

### Naming resource route parameters

`parameters` renames the URI parameter. The default is the singular of the last segment, so `photos` uses `{photo}`.

```ts
Route.resource("users", AdminUserController, {
  parameters: { users: "admin_user" },
});
```

The show route is then `/users/{admin_user}`.

### Scoping resource routes

Chain `scopeBindings()` when a nested child must belong to the parent resolved for that request. The parent model implements `resolveChildRouteBinding`. See [routing](/docs/1.x/routing).

```ts
Route.resource("photos.comments", PhotoCommentController).scopeBindings();
```

### Middleware and resource controllers

Middleware on the group applies to every action the resource registered.

```ts
Route.middleware("web").group(() => {
  Route.resource("photos", PhotoController);
});
```

## Dependency injection and controllers

Type the action’s first parameter as `Request` and the kernel passes the current request. A form request is a `Request` that also authorizes and validates. Call `from` so that work finishes before you read the payload:

```ts
import LoginRequest from "@/Http/Requests/LoginRequest.ts";

export default class AuthController {
  async login(request: Request) {
    const form = await LoginRequest.from(request);
    return form.validated();
  }
}
```

If `authorize` returns false, the response is 403. If validation fails, an HTML client is redirected back and a JSON client receives 422. [Requests](/docs/1.x/requests) covers the input API. `app/Http/Requests/Auth/LoginRequest.ts` in the Views starter is a complete example: it validates, checks the credentials, and locks out repeated failures.
