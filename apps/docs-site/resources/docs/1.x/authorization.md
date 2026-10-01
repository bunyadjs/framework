---
title: Authorization
description: Authorize actions with gates, policies, AccessResponse, and the can middleware.
---

# Authorization

## Introduction

Authentication tells you who the visitor is. Authorization decides what that user may do. Even a signed-in user may not update every post or open an admin screen.

Bunyad gives you two tools. **Gates** are named callbacks for one-off abilities (`admin`, `update-post`). **Policies** group abilities around one model (`view`, `update`, `delete` on `Post`). Most apps use both.

Import from `@bunyad/auth`:

```ts
import { Gate, authorize, can, Authorizable, AccessResponse } from "@bunyad/auth";
```

## Gates

### Defining gates

Register a gate with `Gate.define`. The callback receives the current user (or `null` for a guest) and any extra arguments you pass when you check the ability.

Define gates when your app boots — for example in a service provider:

```ts title="app/Providers/AppServiceProvider.ts"
import { Gate } from "@bunyad/auth";
import type Post from "@/Models/Post.ts";

export default class AppServiceProvider {
  boot(): void {
    Gate.define("update-post", (user, post) => {
      const model = post as Post;
      return user != null && Number(user.id) === Number(model.user_id);
    });
  }
}
```

Gates may return a boolean or an [`AccessResponse`](#gate-responses).

You can also point an ability at a policy method:

```ts
Gate.define("update-post", [PostPolicy, "update"]);
```

Policy classes may define `before(user, ability, …args)`. A non-null return short-circuits that check (same idea as `Gate.before`).

### Checking gates

Pass the current `request` so the gate can resolve the authenticated user from the default guard. Prefer `allows` / `denies` when you branch; use `authorize` when failure should stop the request with 403.

```ts title="app/Http/Controllers/PostController.ts"
import type { Request } from "@bunyad/http";
import { Gate, authorize } from "@bunyad/auth";
import type Post from "@/Models/Post.ts";

export default class PostController {
  async update(request: Request, post: Post) {
    if (!(await Gate.allows(request, "update-post", post))) {
      // Handle denial yourself…
    }

    await authorize(request, "update-post", post);
    // The action is authorized…
  }
}
```

`authorize(request, ability, …args)` is the same as `Gate.authorize`. On denial it aborts with the status and message from the `AccessResponse` (default 403 / `This action is unauthorized.`).

Check several abilities at once:

```ts
// Every ability must pass
await Gate.check(request, ["update-post", "publish-post"], post);

// At least one must pass
await Gate.any(request, ["update-post", "delete-post"], post);

// None may pass
await Gate.none(request, ["update-post", "delete-post"], post);
```

`Gate.has("update-post")` is true when that ability name is defined. `Gate.abilities()` returns the defined names.

### Checking another user

`Gate.forUser(user)` returns a scoped gate that always uses that user (or `null`). Pass `undefined` as the request:

```ts
if (await Gate.forUser(user).allows(undefined, "update-post", post)) {
  // …
}

if (await Gate.forUser(null).denies(undefined, "admin")) {
  // Guests cannot…
}
```

### Intercepting every check

`Gate.before` runs before abilities and policies. Return a boolean or `AccessResponse` to short-circuit. Return `null` or `undefined` to continue.

```ts
Gate.before((user, ability) => {
  if (user != null && (user as { is_admin?: boolean }).is_admin) {
    return true;
  }
  if (ability === "blocked") {
    return false;
  }
  return undefined;
});
```

`Gate.after` runs after the check. Return a boolean to replace the result, or `null` / `undefined` to keep it:

```ts
Gate.after((user, ability, result) => {
  // Inspect or override `result`…
  return result;
});
```

### Inline authorization

Authorize a condition without a named ability:

```ts
await Gate.allowIf(Number(user?.id) === Number(post.user_id));
await Gate.denyIf(post.archived);

await Gate.allowIf(() => expensiveCheck());
```

`allowIf` aborts when the condition is false. `denyIf` aborts when it is true. Both accept a boolean, an `AccessResponse`, or an async function that returns either.

### Resource abilities

`Gate.resource` registers the usual CRUD ability names under a prefix, calling matching methods on a policy class:

```ts
import PostPolicy from "@/Policies/PostPolicy.ts";

Gate.resource("posts", PostPolicy);
// Defines: posts.viewAny, posts.view, posts.create, posts.update, posts.delete
```

Pass a custom map as the third argument when your method names differ:

```ts
Gate.resource("posts", PostPolicy, {
  show: "view",
  store: "create",
});
```

Resource registration does not call `Gate.policy`. Use `Gate.policy` (or discovery) when you want model-first policy resolution.

## Gate responses

Return an `AccessResponse` from a gate or policy when you need a message, a code, or a custom HTTP status.

```ts
import { AccessResponse, Gate } from "@bunyad/auth";

Gate.define("edit-settings", (user) => {
  if (user == null) {
    return Gate.deny("Sign in first.");
  }
  if (!(user as { is_admin?: boolean }).is_admin) {
    return Gate.denyWithStatus(403, "Admins only.");
  }
  return Gate.allow();
});
```

Helpers on `Gate` and `AccessResponse`:

| Method | Meaning |
| --- | --- |
| `Gate.allow(message?, code?)` | Allowed response |
| `Gate.deny(message?, code?)` | Denied response |
| `Gate.denyWithStatus(status, message?, code?)` | Denied with that HTTP status |
| `Gate.denyAsNotFound(message?, code?)` | Denied as 404 |

On the response instance: `allowed()`, `denied()`, `message()`, `code()`, `status()`, and `authorize()` (aborts when denied).

```ts
const response = await Gate.inspect(request, "edit-settings");
if (response.denied()) {
  // …
}

const raw = await Gate.raw(request, "edit-settings");
if (raw instanceof AccessResponse) {
  raw.authorize();
}
```

`inspect` returns allow or deny from the boolean outcome. `raw` returns the callback or policy result before boolean coercion (`boolean`, `AccessResponse`, or `null` when nothing matched).

## Policies

Policies are classes that group authorization for one model. Put them in `app/Policies`.

### Generating policies

```shell
bunyad make:policy PostPolicy
bunyad make:policy PostPolicy --model=Post
```

That writes `app/Policies/PostPolicy.ts` with stub methods such as `view`, `create`, `update`, and `delete`. The `--model` flag sets the import; without it, the model name is taken from the policy name (`PostPolicy` → `Post`).

### Registering policies

`AuthServiceProvider` discovers policies at boot. A file named `PostPolicy.ts` that exports a default class, paired with `app/Models/Post.ts` that also exports a default class, is registered with `Gate.policy(Post, PostPolicy)`.

Register by hand when you need an explicit mapping:

```ts
import { Gate } from "@bunyad/auth";
import Post from "@/Models/Post.ts";
import PostPolicy from "@/Policies/PostPolicy.ts";

Gate.policy(Post, PostPolicy);
```

`Gate.policies()` returns a copy of the registered map. `Gate.getPolicyFor(post)` (or the model class) returns a new policy instance, or `null`.

`Gate.flush()` clears abilities, policies, and before/after callbacks. Use it in tests or when re-bootstrapping.

### Writing policies

Each method is an ability. The first argument is the user (`GateUser`: authenticatable or `null`). Instance abilities receive the model next:

```ts title="app/Policies/PostPolicy.ts"
import type { GateUser } from "@bunyad/auth";
import type Post from "@/Models/Post.ts";

export default class PostPolicy {
  view(_user: GateUser, _post: Post) {
    return true;
  }

  create(user: GateUser) {
    return user != null;
  }

  update(user: GateUser, post: Post) {
    return user != null && Number(user.id) === Number(post.user_id);
  }

  delete(user: GateUser, post: Post) {
    return user != null && Number(user.id) === Number(post.user_id);
  }
}
```

Methods may return a boolean or an `AccessResponse`. They may be async.

When you call `Gate.allows(request, "update", post)`, Bunyad looks up the policy for `post`'s constructor and invokes `update(user, post)`.

Guests get `user === null`. Write the check so guests are denied unless you intentionally allow them:

```ts
view(user: GateUser, post: Post) {
  if (post.published) {
    return true;
  }
  return user != null && Number(user.id) === Number(post.user_id);
}
```

## Authorizing with policies

### Via the user model

Mix `Authorizable` into your user model so instances expose `can`, `cannot`, `cant`, and `canAny`:

```ts title="app/Models/User.ts"
import type { Authenticatable } from "@bunyad/auth";
import { Authorizable } from "@bunyad/auth";
import { Model } from "@bunyad/orm";

export default class User
  extends Authorizable(Model)
  implements Authenticatable
{
  declare email: string;
  // …
}
```

```ts
if (await user.can("update", post)) {
  // …
}

if (await user.cannot("delete", post)) {
  // …
}

// All listed abilities must pass
await user.can(["edit", "publish"]);

// At least one must pass
await user.canAny(["delete", "edit"]);
```

These methods call `Gate.forUser(this)` and do not need a request.

### Via the Gate API

```ts
await Gate.allows(request, "update", post);
await authorize(request, "update", post);
```

### Via middleware

`can` from `@bunyad/auth` authorizes before the route runs. Pass a route parameter name to load the model with `request.model(param)`:

```ts
import { auth, can } from "@bunyad/auth";

Route.middleware([auth(), can("update", "post")]).group(() => {
  Route.put("/posts/{post}", [PostController, "update"]);
});
```

Or resolve arguments yourself:

```ts
can("delete", {
  resolve: async (request) => request.model("post"),
});
```

Without a second argument, only the ability is checked (no model). The string alias form is `can:update,post` when you register middleware by name.

On denial, the middleware aborts with 403 like `authorize`.

### Via validation

With `AuthServiceProvider` booted, `Rule.can` and `Rule.canAny` from `@bunyad/validation` ask the gate using the validated request's user. See [Validation](/docs/1.x/validation).

## Clearing state in tests

```ts
import { Gate } from "@bunyad/auth";

Gate.flush();
```

Re-register abilities and policies after flushing, or let your providers boot again.
