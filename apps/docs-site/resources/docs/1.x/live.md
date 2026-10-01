---
title: Live
description: Server-driven components that update without full page loads, written in TypeScript with .view templates.
---

# Live

## Introduction

Live components are server-rendered pages and widgets that update in place. A component is a TypeScript class: its public fields are its state, its methods are actions the browser can call, and a `.view` template renders it. When the user clicks, types, or submits, the browser client sends the change to the server, runs the action, and patches the page with the new HTML. You write no API and no client-side state.

`@bunyad/live` ships the component class, the `/live/update` endpoint, and a small browser client. The Live starter kit builds its whole auth and settings UI this way (`bunyad new live`).

## Creating components

Put components in `app/Live`. Each file is registered by its path in kebab case: `app/Live/Counter.ts` is `counter`, and `app/Live/Settings/Profile.ts` is `settings.profile`.

```ts title="app/Live/Counter.ts"
import { LiveComponent } from "@bunyad/live";

export default class Counter extends LiveComponent {
  count = 0;

  increment(): void {
    this.count += 1;
  }

  view(): string {
    return "live.counter";
  }
}
```

```html title="resources/views/live/counter.view"
<div>
  <span>{{ count }}</span>
  <button type="button" live:click="increment">+</button>
</div>
```

Every public field is sent to the browser in the component's snapshot and back on each update, so keep state small and never put secrets in it. Methods are callable from the browser, except lifecycle hooks, the built-in helpers, names starting with `_`, and `#private` methods. Make any method that must not be called directly `#private`.

Instead of `view()`, a component may implement `html()` and return a string. Override `html()` when a render needs data that should not live in the snapshot, and pass it to the view yourself:

```ts
async html(): Promise<string> {
  const user = await currentUser();
  return getViewFactory().render("live.settings.two-factor", {
    ...this.data(),
    errors: this.getErrorBag(),
    recoveryCodes: user.recoveryCodes(), // rendered, never stored in the snapshot
  });
}
```

## Rendering components

### Full-page components

`Live.route` registers a GET route that mounts a component and renders it inside a layout:

```ts title="routes/auth.ts"
import { Live } from "@bunyad/live";

Route.middleware("guest").group(() => {
  Live.route("/login", "auth.login").name("login");
  Live.route("/reset-password/{token}", "auth.reset-password").name("password.reset");
});
```

Route parameters become the component's initial state (`token` above). The component chooses its layout and title:

```ts
export default class Login extends LiveComponent {
  static layout = "layouts.auth"; // default: layouts.app
  static title = "Log in";
}
```

The layout receives the component as `slot`:

```html title="resources/views/layouts/auth.view"
<main>
  {!! slot ?? '' !!}@yield('content')
</main>
```

A layout can serve both Live pages (`slot`) and ordinary `@extends` pages (`@yield`). An unfilled `@yield` renders its default, or nothing.

### Inside a page

`Live.mount(name, props)` returns a component's HTML for a controller to pass to any view:

```ts
return view("dashboard", { counter: await Live.mount("counter", { count: 5 }) });
```

```html
{!! counter !!}
```

A component can embed another with `await this.live("name", props, { key })` from `html()`. Each child keeps its own state across the parent's re-renders; pass a `key` when the same component appears more than once.

### Routes and the client script

Register the update endpoint and the script once, inside the `web` group so updates have the session and CSRF protection:

```ts title="routes/web.ts"
Route.middleware("web").group(() => {
  Live.routes(Route); // POST /live/update, GET /live/live.js
});
```

Load the script and the CSRF token in the layout's `<head>`:

```html
<meta name="csrf-token" content="{{ csrf_token() }}" />
<script src="/live/live.js" defer></script>
```

## Actions and binding

| Attribute | Does |
| --- | --- |
| `live:click="save"` | Calls `save()` on click. Pass arguments: `live:click="remove(&quot;{{ note.id }}&quot;)"`. |
| `live:submit="login"` | On a form: sends every bound field, then calls `login()`. |
| `live:model="name"` | Sends the field on every input. |
| `live:model.lazy="name"` | Sends the field when it changes (on blur). |
| `live:model.debounce.300="query"` | Sends the field 300 ms after typing stops. |
| `live:model.defer="email"` | Sends nothing until the next action, then sends the field with it. |
| `live:loading` | Gets a `data-loading` attribute while a request is in flight. |
| `live:poll.5s="reload"` | Calls `reload()` every 5 seconds (default: every 2 seconds, `reload`). |

Forms normally use `live:submit` with `live:model.defer` inputs, so typing costs no requests:

```html
<form live:submit="login">
  <input type="email" live:model.defer="email" value="{{ email }}" />
  @error('email')<p>{{ message }}</p>@enderror
  <input type="password" live:model.defer="password" />
  <button type="submit">Log in</button>
</form>
```

Style loading states with Tailwind's data variant: `<button live:loading class="data-loading:opacity-50">`.

## Validation

`this.validate(rules)` validates the component's state. On failure the errors show up in the view through `@error`, and the action stops:

```ts
async register(): Promise<void> {
  const data = await this.validate({
    email: "required|email|unique:users,email",
    password: "required|string|confirmed|min:8",
  });
  // …
}
```

A `ValidationException` thrown anywhere in an action is shown the same way, so `ValidationException.withMessages({ email: "…" })` works as it does in a controller. `this.addError(field, message)` adds one message without stopping; `this.resetErrorBag(...fields)` clears them.

## Lifecycle hooks

| Hook | Runs |
| --- | --- |
| `mount(props)` | Once, on the first render. |
| `boot()` | Before every render, after the action. |
| `updating(field, value)` / `updated(field, value)` | Around each field the browser changes. |
| `updatingEmail(value)` / `updatedEmail(value)` | The same, for one field. |

## Redirects, navigation, and events

| Call | Browser does |
| --- | --- |
| `this.navigate(url)` | Loads the page without a full reload. |
| `this.redirect(url)` | Full page load. |
| `this.dispatch(name, params)` | Fires a `CustomEvent` on `document`. |

In `mount()`, both `redirect` and `navigate` become an HTTP redirect when the page is first requested.

Use `navigate` after most actions. Use `redirect` after logging out or deleting an account, so nothing from the old session stays on the page.

## Navigating without reloads

Add `live:navigate` to a link to swap the page body in place:

```html
<a href="{{ route('profile.edit') }}" live:navigate>Settings</a>
```

The client prefetches the page when the pointer hovers the link, updates the title and the CSRF token, follows server redirects, and keeps the back button working. It fires `live:navigated` on `document` afterwards. Scripts inside the new body do not run again, so put page behaviour in a script in `<head>` that listens for `live:navigated`.

## Security

Updates post to `/live/update`, not to the page's route, so **the page route's middleware does not run for actions**. An action that needs a signed-in user must check for itself:

```ts title="app/Support/auth.ts"
export async function currentUser(): Promise<User> {
  const user = await Auth.user(request());
  if (!user) abort(401);
  return user as User;
}
```

The same goes for password confirmation and permissions: check them in the action. `abort(401)` and other HTTP errors reach the browser with their status.

The snapshot is signed with `APP_KEY`, so the browser cannot invent state, but it can read it. Keep secrets out of public fields.

## Testing

Test components the way the browser drives them: load the page, read the snapshot, and post actions to `/live/update`. The Live starter kit's `tests/client.ts` has a `live(app, path)` helper:

```ts
const page = await live(app, "/login");
const result = await page.call("login", { email: "ada@example.com", password: "password" });

expect(result.effects.navigate).toBe("/dashboard");
expect(result.html).not.toContain("do not match");
```

`result.effects` holds `navigate`, `redirect`, `events`, and `errors`.
