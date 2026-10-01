---
title: URL Generation
description: Build paths, named-route URLs, signed URLs, and controller-action URLs.
---

# URL Generation

## Introduction

`url`, `route`, `action`, and `asset` build links without hard-coding the host. Use them from a route, a controller, or a view. They live in `@bunyad/router`. A full application installs them as globals, so a template can call `route('profile', { id: user.id })` without an import.

Absolute URLs use the current request's origin when a request is in progress, and `APP_URL` otherwise. `APP_URL` defaults to `http://localhost`. `ASSET_URL` overrides the host for `asset()` only.

## The basics

### Generating URLs

`url("/posts/1")` returns an absolute URL. The path gets a leading slash when you omit one.

```ts
import { url } from "@bunyad/router";

url(`/posts/${post.id}`);
// http://localhost/posts/1
```

`url()` with no path returns the generator. `query` merges parameters onto a path. A key that is already in the path is replaced. Arrays are encoded as `columns[0]`, `columns[1]`, and so on.

```ts
url().query("/posts", { search: "bunyad" });
// http://localhost/posts?search=bunyad

url().query("/posts?sort=latest", { search: "bunyad" });
// http://localhost/posts?sort=latest&search=bunyad

url().query("/posts?sort=latest", { sort: "oldest" });
// http://localhost/posts?sort=oldest

url().query("/posts", { columns: ["title", "body"] });
// http://localhost/posts?columns[0]=title&columns[1]=body
```

`secure(path)` is `to(path)` with `http:` rewritten to `https:`. `forceScheme("https")` and `forceHttps()` do that for every absolute URL generated afterwards. `setRoot` and `forceRootUrl` replace the origin used when there is no current request.

`isValidUrl` is true only for absolute `http` and `https` URLs.

### Accessing the current URL

`current()` is the origin and path, without the query string. `full()` is the request URL as received, including the query string. Both fall back to the root URL when no request is bound.

```ts
url().current();
url().full();
```

`previous()` reads `_previous.url` from the session, then the `Referer` header, then the fallback (`/`). `previousPath()` is the path portion of that URL.

```ts
url().previous();
url().previousPath();
request.session?.previousUrl();
request.session?.previousRoute();
```

`handleUrl()` is the middleware that stores `_previous.url`. It runs on `GET` requests whose `Accept` header includes `text/html`, and it skips a write when the stored URL is already this request. Add it to the `web` group, ahead of routes that call `redirect().back()`:

```ts
import { handleUrl } from "@bunyad/router";

app.middlewareGroup("web", [startSession(), handleUrl(), verifyCsrf()]);
```

Without it, `previous()` still works when the browser sent `Referer`.

## URLs for named routes

`route(name, params, absolute)` fills the path of a named route. The default is a relative path. Pass `true` for an absolute URL. `url().toRoute(name, params)` is always absolute.

```ts
Route.get("/post/{post}", [PostController, "show"]).name("post.show");

route("post.show", { post: 1 });
// /post/1

route("post.show", { post: 1 }, true);
// http://localhost/post/1
```

Several parameters fill several placeholders:

```ts
Route.get("/post/{post}/comment/{comment}", [CommentController, "show"]).name(
  "comment.show",
);

route("comment.show", { post: 1, comment: 3 });
// /post/1/comment/3
```

A key that is not a placeholder is appended as a query parameter:

```ts
route("post.show", { post: 1, search: "rocket" });
// /post/1?search=rocket
```

An object is reduced to a route key. `getRouteKey()` wins when the object has that method. Otherwise `id` is used.

```ts
route("post.show", { post: { id: 42 } });
// /post/42

route("post.show", { post: { getRouteKey: () => "slug-a" } });
// /post/slug-a
```

`Url.defaults({ locale: "en" })` fills any placeholder you do not pass. Set it from middleware when every route shares a parameter such as `{locale}`:

```ts
import { Url } from "@bunyad/router";

Url.defaults({ locale: request.string("locale", "en") });
route("posts.index");
// /en/posts
```

`getDefault(key)` and `getDefaults()` read that map. A value you pass to `route` replaces the default for that call.

## Signed URLs

`signedRoute` appends a `signature` query parameter. The signature is an HMAC-SHA256 of the path and query, keyed by `APP_KEY`. The default result is an absolute URL. Pass `false` as the third argument for a path-only URL.

```ts
import { Url } from "@bunyad/router";

Url.signedRoute("unsubscribe", { user: 1 });
// http://localhost/unsubscribe/1?signature=...

Url.signedRoute("unsubscribe", { user: 1 }, false);
// /unsubscribe/1?signature=...
```

`temporarySignedRoute` also adds `expires`, a unix timestamp. The second argument is a `Date`, a unix timestamp in seconds (a number greater than one billion), or a number of minutes from now.

```ts
Url.temporarySignedRoute("unsubscribe", 30, { user: 1 }, true);
```

In production, signing throws when `APP_KEY` is empty. Call `Url.setKey(key)` or set `APP_KEY` before you sign. Outside production, an empty key uses a built-in development key. Do not ship that key.

### Validating signed requests

`request.hasValidSignature()` checks the signature on the current URL. An `expires` value in the past fails. Import `@bunyad/router` before the check so the checker is registered.

```ts
Route.get("/unsubscribe/{user}", (request) => {
  if (!request.hasValidSignature()) {
    abort(401);
  }
  return "Unsubscribed";
}).name("unsubscribe");
```

`Url.hasValidSignatureWhileIgnoring(request, ["page", "order"])` ignores those query keys, and keys that start with `page[` or `order[`, before hashing. Anyone can change an ignored parameter. The same ignore list is available on the request: `request.hasValidSignatureWhileIgnoring(["page"])`. `request.hasValidSignature(true)` checks the absolute URL, including the origin, which only matches signatures created when the absolute form was hashed with the origin.

The `signed` middleware aborts with 403 and "Invalid signature." when the check fails. `signed({ absolute: true })` checks the origin as well. The alias is `"signed"` or `"signed:absolute"`.

```ts
import { signed } from "@bunyad/router";

Route.get("/unsubscribe/{user}", [NewsletterController, "unsubscribe"])
  .name("unsubscribe")
  .middleware(signed());
```

## URLs for controller actions

`action([Controller, "method"], params, absolute)` finds the route whose action is that tuple and fills its path. The default is absolute. A class passed on its own is resolved as `[Class, "__invoke"]` only when a route was registered that way. The route tuple you wrote is what must match.

```ts
import { action } from "@bunyad/router";
import HomeController from "@/Http/Controllers/HomeController.ts";

action([HomeController, "index"]);
action([UserController, "show"], { id: 1 });
```

If no route uses that controller and method, `action` throws `Action HomeController@index not defined.`

## Fluent URI objects

`Uri` wraps a URL so you can replace one piece at a time. Each method returns a new `Uri`. `toString()` is the URL.

```ts
import { Uri } from "@bunyad/router";

Uri.of("https://example.com/path")
  .withScheme("http")
  .withHost("test.com")
  .withPort(8000)
  .withPath("/users")
  .withQuery({ page: 2 })
  .withFragment("section-1")
  .toString();
```

`withHost` sets the host and clears a previous port when the string has none. `withPort(null)` removes the port. `withQuery` replaces keys you pass and appends array values as `key[0]`. `withFragment` stores the hash without requiring a leading `#`.

Static helpers build the starting URL the same way as the functions above, and they are absolute:

```ts
Uri.to("/dashboard");
Uri.route("users.show", { user: 1 });
Uri.signedRoute("users.show", { user: 1 });
Uri.temporarySignedRoute("users.show", 5, { user: 1 });
Uri.action([UserController, "index"]);
```

`path()` is the pathname only.

## Assets

`asset("css/app.css")` prefixes `ASSET_URL`, or `APP_URL` when `ASSET_URL` is unset. A path that is already absolute is returned as given. The second argument forces `https` (`true`) or `http` (`false`).

```ts
import { asset } from "@bunyad/router";

asset("images/logo.svg");
asset("images/logo.svg", true);
```

`url().assetFrom(root, path, secure)` uses a root you pass instead of `ASSET_URL`.
