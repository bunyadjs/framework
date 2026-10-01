---
title: Inertia
description: Build React, Vue, or Svelte pages served by Bunyad controllers, with no API in between.
---

# Inertia

## Introduction

[Inertia](https://inertiajs.com) lets a controller return a React, Vue, or Svelte page instead of a view. Routing, controllers, validation, and auth stay on the server; the page component receives its data as props. After the first load, links and forms fetch only the next page's props as JSON and swap the component, so the app feels like a single-page app without a separate API.

`@bunyad/inertia` is the server side. The React, Vue, and Svelte starter kits (`bunyad new react`, `vue`, or `svelte`) wire it up with pages for sign-up, login, two-factor authentication, password reset, verification, and settings.

## Rendering pages

Return `Inertia.render(component, props)` from a controller. The component name is the page's path under `resources/js/pages`:

```ts title="app/Http/Controllers/Settings/TwoFactorController.ts"
import { Inertia } from "@bunyad/inertia";

export default class TwoFactorController {
  show(request: Request) {
    const user = request.user as User;
    return Inertia.render("settings/two-factor", {
      enabled: user.hasEnabledTwoFactorAuthentication(),
      recoveryCodes: user.recoveryCodes(),
    });
  }
}
```

A page that needs no controller can be routed directly:

```ts
Inertia.route("/dashboard", "dashboard").middleware("auth", "verified").name("dashboard");
Inertia.route("/about", "about", { team: ["Ada", "Grace"] });
```

After a form submission, redirect as usual. The middleware turns a `302` after `PUT`, `PATCH`, or `DELETE` into `303`, so the browser follows it with `GET`.

## The middleware

Every Inertia app has an `app/Http/Middleware/HandleInertiaRequests.ts` in its `web` group. It sets the props every page gets, the root template, and the asset version:

```ts title="app/Http/Middleware/HandleInertiaRequests.ts"
import { Auth } from "@bunyad/auth";
import { Middleware } from "@bunyad/inertia";

export default class HandleInertiaRequests extends Middleware {
  protected override rootViewName = "app";

  override version(): string | null {
    return String(Bun.file("public/build/app.js").lastModified);
  }

  override async share(request: Request) {
    const user = await Auth.user(request);
    return {
      name: config("app.name"),
      auth: { user: user ? { id: user.id, name: user.name } : null },
      status: request.session?.get<string>("status") ?? null,
    };
  }
}
```

```ts title="bootstrap/middleware.ts"
app.middlewareGroup("web", [startSession(), handleUrl(), verifyCsrf(), new HandleInertiaRequests()]);
```

The middleware runs before route middleware such as `auth`, so resolve the user with `Auth.user(request)` rather than reading `request.user`.

Shared props belong to their request. Two users' requests running at the same time never see each other's `auth.user`. For values that are the same for everyone, `Inertia.share(key, value)` at boot works too.

When `version()` changes (you rebuilt the bundle), the next Inertia visit from an open tab gets a `409` and the client does a full reload onto the new assets.

### Validation errors

The middleware shares flashed validation errors as `errors`, with the first message for each field, which is the shape Inertia's `useForm` reads:

```ts
{ email: "The email field must be a valid email address." }
```

Errors from `request.validateWithBag("userDeletion", …)` nest under the bag name (`errors.userDeletion.password`). A visit that sends an `X-Inertia-Error-Bag` header gets the default errors under that name.

Your own `share()` can set `errors` to override this.

## The root template

The first visit renders the root view (`resources/views/app.view`) with the page encoded in it. Later visits skip it:

```html title="resources/views/app.view"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{{ config('app.name') }}</title>
  <link rel="stylesheet" href="/build/app.css" />
  <script type="module" src="/build/app.js"></script>
</head>
<body>
  <script data-page="app" type="application/json">{!! pageJson !!}</script>
  <div id="app"></div>
</body>
</html>
```

## Pages and the build

The starter kits bundle `resources/js` with `Bun.build` (`scripts/build.ts`). A plugin turns `virtual:pages` into a lazy import for every file under `resources/js/pages`, so adding a page file is all it takes; each page loads in its own chunk:

```ts title="resources/js/app.tsx"
import { createInertiaApp } from "@inertiajs/react";
import { createRoot } from "react-dom/client";
import { pages } from "virtual:pages";

void createInertiaApp({
  resolve: async (name) => (await pages[name]!()).default,
  setup({ el, App, props }) {
    createRoot(el!).render(<App {...props} />);
  },
});
```

Vue `.vue` files are compiled by a small plugin on `@vue/compiler-sfc`; Svelte files by Bun's `bun-plugin-svelte`. The Svelte adapter's `resolve` returns the whole page module rather than `.default`. Inside `resources/js`, `@/` points at `resources/js`. `bun run dev` rebuilds on change.

## Typed routes and props

`bunyad types:generate` reads the app and writes TypeScript for both sides. Run it after changing routes, pages, or shared props, or keep `bunyad types:generate --watch` running (the React kit's `bun run dev` does).

| File | Contents |
| --- | --- |
| `resources/js/routes.ts` | Every named route and a typed `route(name, params)` |
| `resources/js/types/shared.d.ts` | `SharedData`: what `HandleInertiaRequests.share()` returns, plus `errors` |
| `types/inertia.d.ts` | Each page's props, read from the page component |

Pages build URLs from route names; parameters come from the route's URI, so a missing one is a type error. Other keys become the query string:

```tsx
import { route } from "@/routes";

<Link href={route("dashboard")}>Dashboard</Link>
form.patch(route("profile.update"));
route("password.reset", { token, email }); // /reset-password/abc?email=…
```

On the server, `Inertia.render` is checked against the page's own props. The page component is the source of truth:

```tsx title="resources/js/pages/settings/profile.tsx"
export default function Profile({ mustVerifyEmail }: { mustVerifyEmail: boolean }) { … }
```

```ts
Inertia.render("settings/profile", { mustVerifyEmail: true }); // ok
Inertia.render("settings/profil", {});                          // unknown page
Inertia.render("settings/profile", { mustVerify: true });       // unknown prop
```

A prop may also be a closure or a lazy / deferred prop (`Inertia.defer(…)`). Types are printed as plain structures, the shape JSON carries, so the server and the frontend never import each other's files. Until `types/inertia.d.ts` exists, `Inertia.render` accepts any page name and props.

Only `.tsx` pages are read for prop types; Vue and Svelte apps get the routes and shared props.

## Partial reloads and deferred props

Props can be computed only when asked for:

| Helper | Evaluated |
| --- | --- |
| `Inertia.lazy(fn)` / `Inertia.optional(fn)` | Only on a partial reload that names the prop (`router.reload({ only: ["users"] })`). |
| `Inertia.defer(fn, group)` | After the page renders, in a follow-up request per group. |
| `Inertia.always(fn)` | On every visit, including partial reloads that did not name it. |

```ts
return Inertia.render("reports/index", {
  filters,
  totals: Inertia.defer(() => Report.totals()),
});
```

## Merging props

A partial reload normally replaces a prop. `Inertia.merge` adds to it instead, for "load more" buttons and live lists:

```ts
return Inertia.render("activity", {
  events: Inertia.merge(() => Event.after(request.input("after"))).matchOn("id"),
  notices: Inertia.merge(() => newNotices()).prepend(),
  settings: Inertia.deepMerge(() => ({ theme: { mode: "dark" } })),
});
```

```tsx
router.reload({ only: ["events"], data: { after: events.at(-1).id } });
```

- Arrays are appended; `.prepend()` puts new items first.
- `.matchOn("id")` replaces a row the client already has with the reloaded copy instead of adding it twice.
- `Inertia.deepMerge` merges nested objects and arrays all the way down.
- `router.reload({ only: ["events"], reset: ["events"] })` replaces the prop this once.

## Infinite scroll

`Inertia.scroll` takes a paginator; the client's `<InfiniteScroll>` requests the next or previous page as the user scrolls and adds its rows to the list:

```ts
return Inertia.render("posts/index", {
  posts: Inertia.scroll(() => Post.query().latest().paginate(20)),
});
```

```tsx
import { InfiniteScroll } from "@inertiajs/react";

<InfiniteScroll data="posts">
  {posts.data.map((post) => <PostCard key={post.id} post={post} />)}
</InfiniteScroll>
```

The rows are the paginator's `data`; pass a second argument (`Inertia.scroll(fn, "items")`) when they live under another key. The page parameter is the paginator's page name (`page`).

## Once props

A prop the page needs but that rarely changes (plans, countries) can be sent once. The client keeps it and says so on later visits, and the server skips resolving it:

```ts
plans: Inertia.once(() => Plan.all()),
countries: Inertia.once(() => countries()).as("countries").until(3600),
```

`.as(name)` lets several pages share one remembered value; `.until(seconds)` (or a `Date`) makes it expire. A partial reload that names the prop resolves it again.

## Flash

`Inertia.flash` sends data to the next page only, outside its props: a toast after a redirect.

```ts
Inertia.flash("toast", "Profile saved.");
return redirect(route("profile.edit"));
```

```tsx
const { flash } = usePage();
router.on("flash", (event) => toast(event.detail.flash.toast));
```

It is kept in the session until a page renders it, then gone.

## Redirecting outside the app

`Inertia.location(url)` makes the client do a full page load, for external URLs or pages that are not Inertia pages. Redirects to another origin are converted to this automatically.

## Server-side rendering

The React, Vue, and Svelte starter kits render the first visit to each page on the server and hydrate it in the browser, so the page arrives as HTML (fast first paint, readable by crawlers) and later visits stay client-side. It is set in `config/inertia.ts`:

```ts title="config/inertia.ts"
export default {
  ssr: {
    enabled: !["0", "false"].includes(process.env.INERTIA_SSR_ENABLED ?? ""),
    mode: "inline" as const,
  },
};
```

`inline` mode renders in the server process, with no separate port: the framework loads `renderInertiaPage` from `bootstrap/inertia-ssr.ts` (or `.tsx`), which imports pages straight from `resources/js/pages`. `INERTIA_SSR_ENABLED=0` turns it off. `http` mode posts the page to a separate render server instead (`url`, default `http://127.0.0.1:13714`). If rendering fails or times out, the page falls back to client rendering.

Code that runs during a component's first render runs on the server too, where there is no `window`, `document`, or `localStorage`. Read browser-only values after hydration: in `useEffect` (React), `onMounted` (Vue), or `onMount` (Svelte). The kits' appearance setting does this. The client entry hydrates server HTML when the root has `data-server-rendered`, and reads the app name from `<meta name="application-name">`, since the server fills `<title>` with the page's title.

## Testing

Visit pages with the `X-Inertia` header and assert on the page object:

```ts
const inertia = { "X-Inertia": "true", Accept: "text/html, application/xhtml+xml" };

const page = await (await app.get("/settings/profile", inertia)).json();
expect(page.component).toBe("settings/profile");
expect(page.props.auth.user.name).toBe("Ada Lovelace");

(await app.patch("/settings/profile", { name: "Grace" }, inertia)).assertStatus(303);
```

Validation errors appear in the next page's `props.errors`. The starter kits' `tests/client.ts` has `visit` and `expectPage` helpers for this.
