---
title: Route Folders
description: Put a controller, its requests and its routes in one folder, and let the folder decide the URL.
---

# Route Folders

## Introduction

An application's routes live in folders under `routes/`. A folder is a URL. The controller, the form request and the routes for that URL sit in the same folder, so the file for a URL is one `ls` away.

```text
src/
  web/
    middleware.ts                 // ["web"]
    (guest)/
      middleware.ts               // ["guest"]
      login/
        AuthenticatedSessionController.ts
        LoginRequest.ts
    settings/
      middleware.ts               // ["auth"]
      profile/
        ProfileController.ts
  api/
    me/
      UserController.ts
      middleware.ts
```

`routes/` is the route tree. `bunyad route:list`, `compile` and `optimize` read it, and so does the app at boot.

Middleware and URL prefixes come from `middleware.ts` files. A route tree is the web interface (the `web` middleware group) unless a root `app.routes.ts` says otherwise; the API starter's says `export const prefix = "api";` and `export default ["api"];`, so every route below it gets the `api` group and an `/api` prefix.

An app with a web interface and an API puts each in a **group folder**, which adds no URL segment, and gives each its own `middleware.ts`:

```text
src/
  (web)/middleware.ts      // ["web"]
  (web)/login/…
  (api)/middleware.ts      // prefix = "api", ["api"]
  (api)/me/…
```

## Folder names

| Folder | URL |
| --- | --- |
| `products` | `/products` |
| `[product]` | `/{product}` (a route parameter) |
| `(guest)` | nothing. A group folder shares its middleware without adding a URL segment |
| `_helpers` | ignored. Anything that starts with `_` or `.` is private to the folder |

Catch-all folders (`[...rest]`) are not supported.

## Files in a folder

| File | Meaning |
| --- | --- |
| `controller.ts` or `NameController.ts` | The controller. The default export is the class. One per folder |
| `NamePage.tsx`, `.vue`, `.svelte` | The folder's view (see [Views](#views)) |
| `requests.ts` or `NameRequest.ts` | Form request classes for the controller |
| `middleware.ts` | Middleware for this folder and every folder below it |
| `route.ts` | Routes you write yourself for this folder |
| `*.test.ts`, `*.spec.ts` | Ignored |

Prefer the descriptive names (`LoginController.ts`, `LoginRequest.ts`). They match the class inside, show up by name in search, and do not turn every editor tab into `controller.ts`.

A form request that the controller type-hints is found from the controller file, so keep the `import` next to it:

```ts title="routes/(auth)/login/AuthenticatedSessionController.ts"
import LoginRequest from "./LoginRequest.ts";

export default class AuthenticatedSessionController {
  async store(request: LoginRequest) {
    // …
  }
}
```

## Controller actions become routes

A folder that has an `index` method, or a `[param]` folder inside it, is a **resource**:

| Method | HTTP | URL | Name |
| --- | --- | --- | --- |
| `index` | GET | `/products` | `products.index` |
| `create` | GET | `/products/create` | `products.create` |
| `store` | POST | `/products` | `products.store` |
| `show` | GET | `/products/{product}` | `products.show` |
| `edit` | GET | `/products/{product}/edit` | `products.edit` |
| `update` | PUT, PATCH | `/products/{product}` | `products.update` |
| `destroy` | DELETE | `/products/{product}` | `products.destroy` |

A controller defines only the routes it has methods for. Static routes win over dynamic ones, so `/products/create` is never read as a product id. The parameter is named after a `[param]` folder inside the resource, or the singular of the folder name.

Any other folder is **one page** at the folder URL:

| Method | HTTP | URL | Name |
| --- | --- | --- | --- |
| `create`, `show`, `edit` | GET | `/login` | `login` |
| `store` | POST | `/login` | `login.store` |
| `update` | PUT, PATCH | `/settings/profile` | `settings.profile.update` |
| `destroy` | DELETE | `/settings/profile` | `settings.profile.destroy` |

A controller with only a `handle` method is one route at the folder URL. It answers GET unless you say otherwise.

Names come from the folder path with group and parameter folders left out: `routes/settings/profile` is `settings.profile`.

## Views

A view file belongs to the controller of its folder and is named for what it shows. Keep views in a `pages/` subfolder when the folder also holds controllers and form requests, so the frontend and backend files sort apart; `pages/` is a reserved name, and a folder with only a view (a dashboard page, say) can keep it beside the other files: `LoginPage.tsx`, `ProductIndexPage.vue`, `ProfileEditPage.svelte`. A controller returns data and the router renders the view that belongs to the action:

```ts title="routes/settings/profile/ProfileController.ts"
export default class ProfileController {
  edit(request: Request) {
    return { mustVerifyEmail: !request.user.hasVerifiedEmail() };   // props for ProfilePage.tsx
  }
}
```

| File | View of |
| --- | --- |
| `LoginPage.tsx` (the only `*Page` in the folder) | the folder's GET action: `index` in a resource, `create`, `show` or `edit` on a single page |
| `ProductIndexPage.vue`, `ProductCreatePage.vue`, `ProductShowPage.vue`, `ProductEditPage.vue` | the action in the name |
| `create.tsx`, `index.tsx`, `show.tsx`, `edit.tsx`, `page.tsx` | the same, with the short names |

What happens to the value an action returns:

| It returns | Request | Result |
| --- | --- | --- |
| an object, or nothing | GET or HEAD, action has a view | the view, with the object as props |
| an object | `Accept: application/json`, or the action has no view | JSON |
| an object | POST, PUT, PATCH or DELETE | JSON. Return `redirect(...)` to send the browser on |
| a `Response`, redirect, resource, download | any | sent as is |

So any other format is a `Response` away: return `new Response(csv, { headers })`, `json(...)`, a download, or call `Inertia.render("…", props)` yourself for one action that shows a different page.

A folder's view is its GET page even when the controller has no method for it, so a controller that only handles the form post (`store`) needs no empty `create() {}`. Add the method when the page has data to return.

A folder with a view and no controller is a page by itself: a GET at the folder URL, named after the folder, with the folder's `middleware.ts` chain. The root folder's page is named `home`.

Pages are named after their path under `routes/`, without the extension: `(auth)/login/LoginPage`. That is the component name Inertia sends to the browser.

### Server-rendered views and Live components

An app without `resources/views` keeps its `.view` templates in `routes/`. `LoginPage.view` is the view of the `login/` folder, and its controller returns the data. A page starts with `@meta({ title: "Log in" })` to say what its layouts show. A `*Layout.view` in a folder wraps every page in that folder and below, outermost first, and prints the page with `{!! children !!}`; it reads `meta`. `<x-card>` components load from `routes/_components`.

A Live component is a page too: `LoginLive.ts` (a `LiveComponent`) with `LoginPage.view` beside it is served at the folder URL inside the same layouts, with no route to declare. The component registers under its path in `routes/` (`(auth).login.LoginLive`); `static routeName` names the route and `static meta` sets what the layouts show.

`@View("../_shared/FormPage.tsx")` points one action (or the whole controller) at another file, relative to the controller's folder. Keep a view that several actions share in a `_` folder so it does not become a page of its own. New kinds of view files are rendered by registering a responder with `setPageResponder([".mdx"], (page, props) => …)`.

## Tests and types

Put an area's tests in a `_tests/` subfolder next to the code they cover (`(auth)/_tests/auth.test.ts` beside `AuthController.ts`). A folder starting with `_` is never a route, `bun test` still finds the files, and the folder does not need reorganising when the tests multiply. A `*.test.ts` left beside the code is ignored by the router too. Helpers shared by many tests belong in `app/Testing/`.

Types follow the same rule. A type used by one folder goes in a `_types.ts` there, a type shared by many goes in `routes/_types.ts`, and generated ones (the typed `route()` helper, the shared props, each page's props, the `virtual:pages` module) are written to `.bunyad/` by `bunyad types:generate` and are never edited.

## Extra routes on a controller

Decorate a method with `@Get`, `@Post`, `@Put`, `@Patch` or `@Delete` to give it a route. The path is relative to the folder's URL, and a decorated method does not also get its convention route:

```ts title="routes/settings/two-factor/TwoFactorController.ts"
import { Name, Post } from "@bunyad/http";

export default class TwoFactorController {
  show() {}                                   // GET    /settings/two-factor
  store() {}                                  // POST   /settings/two-factor
  destroy() {}                                // DELETE /settings/two-factor

  @Post("/confirm")                           // POST   /settings/two-factor/confirm
  confirm() {}

  @Post("/recovery-codes")
  @Name("two-factor.recovery-codes")
  regenerateRecoveryCodes() {}
}
```

A folder holds one controller, but a controller can own several URLs. Put it in a `(group)` folder, which adds no URL segment, and write the full paths:

```ts title="routes/(auth)/AccountSecurityController.ts"
export default class AccountSecurityController {
  @Get("/confirm-password") confirm() {}
  @Get("/email/verify") verify() {}
}
```

Use this when the routes belong together. Keeping one folder per URL stays the default, because then the folder tells you where the code is.

### Parent controllers and method names

A folder does not need a controller of its own. The nearest controller in a parent folder serves it, and a
method named after the folder answers its requests:

```text
routes/(auth)/
  AuthController.ts   ← the parent controller
  (guest)/login/LoginPage.tsx
  (guest)/register/RegisterPage.tsx
```

```ts title="routes/(auth)/AuthController.ts"
export default class AuthController {
  async postLogin(request: LoginRequest) { … }   // POST /login
  async postRegister(request: Request) { … }     // POST /register
  // GET /login and GET /register need no data, so there is no method: the page renders on its own
}
```

| Request to the folder `login/` | Method |
| --- | --- |
| GET | `login()`, optional: its returned object is the page's props |
| POST | `postLogin()` |
| PUT or PATCH | `putLogin()` or `patchLogin()` |
| DELETE | `deleteLogin()` |

The name is the folder's last segment in camelCase (`forgot-password` is `forgotPassword`), and a `[token]`
folder uses the name of the folder above it. A GET needs a page in the folder. A folder with its own
controller overrides the parent's, and a folder with no controller anywhere above it still renders its page.
Routes with no folder of their own (a logout button, a signed link) are declared on the controller with
`@Post("/logout")` and `@Get("/email/verify/{id}/{hash}")`.

### Related routes in one folder

A `(group)` folder has no URL of its own, so it may hold **several controllers**, and every route in it is declared. Put the related actions together there, with their pages and form requests:

```text
src/(auth)/
  SessionController.ts          login, two-factor challenge, password confirmation, logout
  RegistrationController.ts     sign up and email verification
  PasswordResetController.ts    forgot and reset password
  LoginRequest.ts
  pages/
    LoginPage.tsx  RegisterPage.tsx  ForgotPasswordPage.tsx  …
```

Each route says its path, name and middleware in one line:

```ts title="routes/(auth)/SessionController.ts"
export default class SessionController {
  @Get("/login", { name: "login", middleware: ["guest"] })
  login() {}                                   // renders LoginPage.tsx

  @Post("/login", { name: "login.store", middleware: ["guest"] })
  async authenticate(request: LoginRequest) { … }
}
```

In a group folder a method is a route only if it has a route decorator, so helper methods stay private, and a GET method's view is the `*Page` named after it: `login()` renders `LoginPage`, `twoFactorChallenge()` renders `TwoFactorChallengePage`. The options are `name` and `middleware`; `@View("…")` still points at another file. Two controllers in an ordinary folder are an error.

## Decorators

Middleware, names and verbs that do not follow the folder go on the controller:

```ts title="routes/(auth)/email/verify/[id]/[hash]/VerifyEmailController.ts"
import { Middleware, Name } from "@bunyad/http";

@Name("verification.verify")
@Middleware("signed", "throttle:6,1")
export default class VerifyEmailController {
  async handle(request: Request) {
    // …
  }
}
```

| Decorator | On | Effect |
| --- | --- | --- |
| `@Middleware(...)` | class or method | Adds middleware to every action, or to one |
| `@Name("…")` | class or method | Sets the route name |
| `@Method("POST")` | class | Sets the verb of a `handle` controller |
| `@Get("/x")`, `@Post("/x")`, `@Put`, `@Patch`, `@Delete` | method | Adds a route for that method |

## Middleware and who may open what

Put an area's access rules in a `<area>.routes.ts` beside its parent controller (`auth.routes.ts` next to `AuthController.ts`), or `app.routes.ts` at the root. It exports an object:

```ts title="routes/(auth)/auth.routes.ts"
export default {
  access: "guest",                                   // every page and method below is for guests …
  rules: { auth: ["confirm-password", "email/verify"] },   // … except these, which are for signed-in users
};
```

| Key | Meaning |
| --- | --- |
| `access` | `"guest"` or `"auth"`: who may open everything in this folder and below, so a controller with many methods does not repeat it |
| `rules` | Middleware name to URL patterns, relative to the file's folder. `*` is one segment and `**` is the rest. A rule covers every method of a matching URL, including the form post |
| `use` | Middleware for every route in this folder and below |
| `prefix` | A URL prefix for every route in this folder and below (`"api"`) |

`guest` and `auth` replace each other: a route has one of them, and the most specific wins (the folder's `access`, then `rules`, then `{ access: "auth" }` on a route decorator). A pattern that matches no route is a build error, so a renamed folder cannot leave a stale rule behind, and `bunyad route:list` shows the chain each route ends up with. A route tree is the `web` middleware group unless a root `*.routes.ts` sets `use`.

For one action, keep the middleware on the controller (`@Middleware("throttle:5,1")`, or `{ access, middleware }` on a route decorator). `@Middleware("guest")` on a controller class or method also works with no routes file: it runs for every method of that controller, and for the pages under it, but not mixed with `access` on the same routes. The older `middleware.ts`, which applies to its folder and below, still works.

The chain for a route runs from the outermost folder inward: the root, then each folder, then the rules, then the controller and action decorators. A middleware that appears twice runs once.

### Permissions and deny by default

`rules` takes any middleware name, so a permission is a rule: `"can:manage-billing": "billing/**"` runs the Gate for every URL below `billing`. On a controller, `@Can("update", "post")` is the same as `@Middleware("can:update,post")`, for the class or one action.

Add `strict: true` to an area and every route in it has to say who may open it, by `access`, a rule, `{ access }` on a decorator, `@Middleware("auth")` or `@Can(…)`. A route that says nothing is a build error that names it. `public` is the way to say "anyone": `rules: { public: ["pricing", "terms"] }`, or `{ access: "public" }` on a decorator. It removes `guest` and `auth` and adds no middleware.

```ts title="routes/(app)/app.routes.ts"
export default {
  strict: true,
  access: "auth",
  rules: { public: "pricing", "can:manage-billing": "billing/**" },
};
```

## Error pages

Put `NotFoundPage` (404), `ForbiddenPage` (403), `ExpiredPage` (419) or `ErrorPage` (any other status) at the root of `routes/`, with the extension of your frontend (`.tsx`, `.vue`, `.svelte`, `.view`). A browser that hits that status gets the page, inside the root layout, with `status` and `message` as props. JSON requests keep their JSON error, a missing page file keeps the built-in page, and with `APP_DEBUG` on a 500 still shows the debug page. These files are not routes.

## Domains and tenants

An area answers on a host when its routes file says `domain`:

```ts title="routes/(admin)/admin.routes.ts"
export default { domain: "admin.{root}" };       // {root} is APP_DOMAIN
```

```ts title="routes/(tenant)/tenant.routes.ts"
export default { domain: ["{tenant}.{root}", "shop.example.net"] };   // request.route("tenant") is the label
```

An exact host wins over a pattern, and an area with no `domain` answers on every host. Customers' own domains, kept in a database, are mapped to a host the areas already match:

```ts title="app/Providers/AppServiceProvider.ts"
Domain.resolver(async (host) => {
  const domain = await TenantDomain.where("host", host).where("status", "active").first();
  return domain ? `${domain.tenant.slug}.${process.env.APP_DOMAIN}` : null;   // null: not served
}, { ttl: 60_000 });
```

The resolver is not asked about `APP_DOMAIN` or its subdomains, and its answers are cached for `ttl`; call `Domain.forget(host)` when a domain is verified or disabled. `compile` keeps the `domain` of every route.

## Translations

`lang/en.json` holds app-wide messages, and a `lang.<locale>.json` in any route folder holds that page's, with the folder's name in front of each key (`routes/(auth)/login/lang.en.json` with `{ "title": "Log in" }` is `login.title`; group, `[param]` and `_` folders add nothing). Read them with `trans("login.title")` (or `__()`, also in `.view` templates), with `:name` replaced from the second argument. `setLocale("fr")` switches the locale and `fallback_locale` in `config/app.ts` is used for missing keys. To give a frontend its messages, share them: `translations("fr", "login")` returns the flat `{ key: text }` object.

## Typed props

The page component says what props it takes (React's parameter type, Vue's `defineProps<{ … }>()`, Svelte's `$props()` type), and `bunyad types:generate` turns that into `Pages` in `.bunyad/inertia.d.ts`. It also writes `.bunyad/props.check.ts`: one line per action that returns data for a page, which stops type-checking when the returned object does not fit the page's props.

## When you need a `route.ts`

Use a `route.ts` for a page with no controller, or a group of routes with shared middleware that decorators cannot express. The file exports a function, the URIs are relative to the folder, and the folder's `middleware.ts` chain is applied:

```ts title="routes/(auth)/reset-password/route.ts"
import { Route } from "@bunyad/router";
import Controller from "./NewPasswordController.ts";

export default function (): void {
  Route.get("/{token}", [Controller, "create"]).name("password.reset");
  Route.post("/", [Controller, "store"]).name("password.store");
}
```

A folder with a `route.ts` uses it instead of the conventions, so its controller's methods are not turned into routes a second time.

Two routes with the same method and URL are an error that names both controllers.
