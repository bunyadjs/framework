---
title: API Resources
description: Transform models and collections into JSON with JsonResource.
---

# API Resources

## Introduction

API resources turn models and collections into a stable JSON shape for your HTTP clients. Instead of returning a model’s `toArray()` dump, you map fields explicitly, hide secrets, and nest related resources only when they are loaded.

`JsonResource` and `ResourceCollection` live in `@bunyad/http`. Generate a stub with:

```bash
bunyad make:resource UserResource
```

That writes `app/Http/Resources/UserResource.ts` extending `JsonResource`.

```ts
import { JsonResource } from "@bunyad/http";
import type User from "@/Models/User.ts";

export default class UserResource extends JsonResource<User> {
  toArray() {
    const user = this.resource;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
    };
  }
}
```

Return `UserResource.make(user)` or `UserResource.collection(users)` from a controller. The framework turns the resource into a JSON response.

## Writing resources

Subclass `JsonResource`, type the wrapped value, and implement `toArray`. Access the underlying model (or array) through `this.resource`.

```ts title="app/Http/Resources/UserResource.ts"
import { JsonResource } from "@bunyad/http";
import type User from "@/Models/User.ts";

export default class UserResource extends JsonResource<User> {
  toArray(_request?: unknown) {
    return {
      id: this.resource.id,
      name: this.resource.name,
      email: this.resource.email,
      created_at: this.resource.created_at,
    };
  }
}
```

`toArray` may accept the current request when you need query or auth context. `resolve(request)` / `transform(request)` call `toArray` and strip any `MissingValue` keys produced by conditional helpers.

### Creating a single resource

```ts
import User from "@/Models/User.ts";
import UserResource from "@/Http/Resources/UserResource.ts";

const user = await User.findOrFail(1);

return UserResource.make(user);
```

`make` constructs the resource. When the kernel converts it to a response, the default wrap key is `data`:

```json
{
  "data": {
    "id": 1,
    "name": "Ada",
    "email": "ada@example.com"
  }
}
```

Call `toResponse(request)` or `response(status)` yourself when you need an explicit `Response`:

```ts
return UserResource.make(user).toResponse(request, 200);
return UserResource.make(user).response(201);
```

### Resource collections

Wrap an array, an `{ all() }` collection, or a length-aware / simple / cursor paginator:

```ts
const users = await User.query().get();

return UserResource.collection(users);
```

```json
{
  "data": [
    { "id": 1, "name": "Ada", "email": "ada@example.com" },
    { "id": 2, "name": "Grace", "email": "grace@example.com" }
  ]
}
```

Paginated collections merge the mapped rows into the paginator’s `toJSON` payload (`data`, `links`, `meta`):

```ts
const page = await User.query().paginate(15);

return UserResource.collection(page);
// or
return UserResource.paginate(page);
```

`ResourceCollection.resolve()` returns the array of resolved item objects. `count()` returns how many items were collected for the current page or list.

### Nested resources

Nest another resource’s `toJSON()` (unwrapped attributes) inside your map:

```ts
import PostResource from "@/Http/Resources/PostResource.ts";

toArray() {
  return {
    id: this.resource.id,
    title: this.resource.title,
    author: this.whenLoaded(
      "author",
      () => AuthorResource.make(this.resource.author!).toJSON(),
    ),
    posts: PostResource.collection(this.resource.posts ?? []),
  };
}
```

Nested `toJSON()` / `resolve()` values are **not** wrapped in `data`. Wrapping applies when the resource is the top-level HTTP response.

## Conditional attributes

### `when` / `unless`

Include a value only when a condition is true. Failed conditions become a `MissingValue` and are omitted from the JSON:

```ts
toArray() {
  return {
    id: this.resource.id,
    email: this.when(Boolean(this.resource.email), this.resource.email),
    secret: this.unless(this.resource.is_public, this.resource.secret),
  };
}
```

Pass a function as the value when computation should run only if the condition passes. An optional third argument is the fallback (default: omit).

### `whenNotNull` / `whenNull`

```ts
email: this.whenNotNull(this.resource.email),
placeholder: this.whenNull(this.resource.email, () => "missing"),
```

### `merge` / `mergeWhen` / `mergeUnless`

Spread extra keys into the object when a condition holds:

```ts
toArray() {
  return {
    id: this.resource.id,
    ...this.mergeWhen(this.resource.is_admin, {
      role: "admin",
      permissions: this.resource.permissions,
    }),
    ...this.merge({ type: "user" }),
  };
}
```

### `whenLoaded`

Include a relation only when it has been eager-loaded (or is already present on the model):

```ts
posts: this.whenLoaded("posts"),
posts: this.whenLoaded("posts", () =>
  PostResource.collection(this.resource.posts!),
),
```

`whenExistsLoaded` is an alias of `whenLoaded`.

### Aggregates and appends

After `loadCount` / `loadSum` (and related helpers) on the model:

```ts
posts_count: this.whenCounted("posts"),
revenue_sum: this.whenAggregated("orders", "sum_total"),
```

`whenAppended("is_admin")` includes a value when that attribute is present on the model.

### Pivot attributes

```ts
if (this.hasPivotLoaded("role_user")) {
  // ...
}

meta: this.whenPivotLoaded("role_user", () => this.resource.pivot),
```

`hasPivotLoadedAs` / `whenPivotLoadedAs` use a custom accessor name instead of `pivot`.

## Data wrapping

By default, top-level resources wrap attributes under `data`. Change the key for one instance or for the class:

```ts
UserResource.make(user).wrap("user");
UserResource.make(user).withoutWrapping();

JsonResource.wrap("payload"); // process-wide default for subclasses that inherit wrapKey
JsonResource.withoutWrapping();
```

`withoutWrapping()` on an instance sets the wrap key to `null` for that response. Extra keys from `with` / `additional` still merge at the top level.

## Meta and additional data

```ts
return UserResource.make(user)
  .with({ meta: { version: 1 } })
  .additional({ links: { self: `/users/${user.id}` } });
```

On paginated collections, `additional` merges into the paginator JSON (useful for extra `meta` keys).

## Response hooks

```ts
return UserResource.make(user).withResponse((response) => {
  response.headers.set("X-Resource", "user");
});
```

## Filtering missing values

`filter` / `removeMissingValues` run the same `MissingValue` cleanup as `resolve`:

```ts
const data = UserResource.make(user).filter();
```

`MissingValue` is exported from `@bunyad/http` if you need the sentinel directly. `JsonResource.collection(missingValue)` returns the same `MissingValue` so nested conditionals stay consistent.

## JSON:API resources

For `application/vnd.api+json` documents, extend `JsonApiResource` instead of `JsonResource`. Override `toAttributes` and optionally `toRelationships`. Pass the request with `withRequest` so `?include=` and `?fields[type]=` sparse fieldsets apply.

```ts
import { JsonApiResource } from "@bunyad/http";
import type User from "@/Models/User.ts";

export default class UserJsonApiResource extends JsonApiResource<User> {
  toAttributes() {
    return {
      name: this.resource.name,
      email: this.resource.email,
    };
  }

  toRelationships() {
    return {
      posts: () => PostJsonApiResource.collection(this.resource.posts ?? []),
    };
  }
}
```

`type()` defaults to a kebab-case class name without a trailing `Resource`. Override `type()` or set a static `type` when you need a fixed string. `id()` reads `getKey()` or `id` on the model.

## Serialization helpers

| Method | Result |
| --- | --- |
| `resolve(request?)` | Attributes object / array with missing keys removed |
| `toJSON()` / `jsonSerialize()` | Same as `resolve()` (unwrapped) |
| `toJson(pretty?)` | JSON string |
| `toPrettyJson()` | Pretty-printed JSON string |
| `payload(request?)` | Wrapped body used by `toResponse` |
| `toResponse` / `response` | `Response` via `json(...)` |

For shaping models without a dedicated resource class, see [ORM Serialization](/docs/1.x/orm-serialization). For attribute transforms before resources run, see [Mutators and Casting](/docs/1.x/orm-mutators).
