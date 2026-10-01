---
title: Views
description: Render .view templates, pass data, and use directives, components, layouts, and forms.
---

# Views

## Introduction

Returning a full HTML document from a route mixes presentation with the action that loaded the data. Views keep the markup in `resources/views`. A view is a `.view` file: HTML, plus directives that print values, branch, loop, include other views, and render components.

```html title="resources/views/greeting.view"
<html>
  <body>
    <h1>Hello, {{ name }}</h1>
  </body>
</html>
```

Return it from a route with `view` from `@bunyad/view`. The first argument is the view name. The second is the data the template reads.

```ts
import { view } from "@bunyad/view";

Route.get("/", () => view("greeting", { name: "James" }));
```

`render(name, data)` returns the HTML string instead of a response. Tests and mail use it when nothing is being sent to a browser.

Expressions inside a template are JavaScript. A name that is not a local is read from the data you passed, so `{{ name }}` prints `data.name`. There is no `$` prefix on variables. `@php` is rejected: put that logic in the controller, or register a helper with `ViewFactory.use`.

The factory compiles a view the first time it is rendered and keeps the function in memory. In development (`BUNYAD_DEV` or `BUNYAD_HOT`) it recompiles from disk on every render, so a save shows up on the next request. A production build can embed precompiled views and refuse to read the template directory.

## Creating and rendering views

Place the file in `resources/views` with a `.view` extension. The name you pass to `view()` is that path with slashes written as dots, and without the extension.

```ts
return view("greeting", { name: "James" });
```

The third argument is the HTTP status. It defaults to 200.

```ts
return view("errors.missing", {}, 404);
```

`Route.view` does not take a template name. It registers a route whose action is a function. Call `view()` inside that function:

```ts
Route.view("/dashboard", () => view("dashboard"));
```

### Nested view directories

A view may live in a subdirectory. `resources/views/admin/profile.view` is `admin.profile`.

```ts
return view("admin.profile", data);
```

Directory names should not contain a dot. The dot is the separator the factory uses when it turns the name into a path.

### Passing data to views

Pass a record of key / value pairs. Each key is a variable in the template.

```ts
return view("greetings", { name: "Victoria" });
```

```html
Hello, {{ name }}.
```

The same record is visible to `@include` unless you pass a second argument that replaces it. Components receive only the attributes you set on the tag, plus `errors`, old input, and the slot.

### Sharing data with all views

`View.share` (or `getViewFactory().share`) merges keys into every render. Explicit render data wins over shared keys.

```ts
import { View } from "@bunyad/view";

View.share("appName", "Karobar");
View.share({ locale: "en" });
```

`View.composer(views, callback)` runs before matching views render. Pass a name, a list of names, or a `*` pattern. The callback may mutate `data` or return an object to merge.

```ts
View.composer("admin.*", (data) => {
  data.nav = "admin";
});
```

`View.exists(name)` checks disk / compiled maps. `View.first(names, data)` renders the first name that exists.

### Helpers available in every view

When the application has installed its globals, these functions are copied into every view so you can call them without passing them as data: `route`, `url`, `asset`, `action`, `config`, `csrf_token`, `app`, `env`, `now`, `today`, `blank`, `filled`, `collect`, `dd`, and `dump`. A key you pass in the data record wins over a helper with the same name.

```html
<a href="{{ route('profile', { id: user.id }) }}">Profile</a>
<img src="{{ asset('images/logo.svg') }}" />
```

`csrf_token()` reads the token from the current request's session. It throws when there is no request or the session middleware has not run.

Register more helpers on the factory. Templates cannot import a file.

```ts
getViewFactory().use("money", (amount: number) => `Rs ${amount}`);
```

```html
@use('money') {{ money(total) }}
```

`@use('money', 'formatMoney')` binds the helper under a different name. `@import` is the same directive. `forgetUse('money')` removes one helper. `forgetUse()` removes all of them.

## Displaying data

`{{ name }}` HTML-encodes the value, then prints it. `{!! bio !!}` prints the value as-is. Use the raw form only for markup you built yourself.

```html
Hello, {{ name }}.
<div>{!! bio !!}</div>
```

`null` and `undefined` print as an empty string. Objects are stringified by the encoder.

`@json(user)` prints JSON with characters escaped so the value can sit inside a `<script>` tag.

```html
<script>
  const user = @json(user);
</script>
```

### If statements

`@if`, `@elseif`, `@else`, and `@endif` compile to JavaScript `if` / `else if` / `else`. The condition is an expression, not a PHP statement.

```html
@if (user)
<p>Hello, {{ user.name }}</p>
@elseif (guest)
<p>Guest</p>
@else
<p>Unknown</p>
@endif
```

`@unless` / `@endunless` is the inverse of `@if`. `@isset(name)` / `@endisset` is true when the value is not `null` or `undefined`. `@empty(items)` / `@endempty` is true for nullish values, `false`, `0`, `""`, `"0"`, `[]`, and `{}` (the bare `@empty` marker inside `@forelse` is separate).

```html
@unless(hidden)
<p>Visible</p>
@endunless

@isset(user)
<p>{{ user.name }}</p>
@endisset

@empty(posts)
<p>No posts yet.</p>
@endempty
```

`@switch` / `@case` / `@break` / `@default` / `@endswitch` compile to a JavaScript `switch`:

```html
@switch(status)
  @case('draft')
    Draft
    @break
  @case('live')
    Live
    @break
  @default
    Unknown
@endswitch
```

`@production` / `@endproduction` and `@env('local')` / `@endenv` branch on the current environment. Pass `__env` in the view data (or `app.env`). `@env` also accepts an array of names.

### Loops

`@foreach` iterates any value that JavaScript can loop with `for...of`. The alias is a local inside the loop. A leading `$` on the alias is ignored.

```html
@foreach (users as user)
<li>{{ user.name }}</li>
@endforeach
```

Inside the loop, `loop` is available: `index` (0-based), `iteration` (1-based), `first`, `last`, and `count`.

```html
@foreach (users as user)
<li class="{{ loop.first ? 'first' : '' }}">{{ loop.iteration }}. {{ user.name }}</li>
@endforeach
```

`@forelse` is like `@foreach`, but `@empty` / `@endforelse` render when the iterable is empty (or missing).

```html
@forelse (users as user)
<li>{{ user.name }}</li>
@empty
<p>No users.</p>
@endforelse
```

### Auth and authorization

`@auth` / `@endauth` and `@guest` / `@endguest` branch on whether a user is present. By default they look for `data.user`, or you can set `__auth` / `__guest` booleans. The framework wires real guards via `setViewAuthHelpers`.

```html
@auth
<p>Hello, {{ user.name }}</p>
@endauth
@guest
<p><a href="/login">Log in</a></p>
@endguest
```

`@can('ability', ...args)` / `@cannot(...)` call the registered Gate helpers (or `data.__can` / `data.__cannot` overrides in tests).

### Conditional classes and styles

`@class` and `@style` print a `class` or `style` attribute from arrays and maps. Object keys whose value is truthy are included; for styles, a key with value `true` is treated as a full CSS declaration.

```html
<div @class([{ 'font-bold': isActive, 'text-red': hasError }])></div>
<div @style([{ 'color: red': hasError, color: accent }])></div>
```

### The `@once` directive

`@once` / `@endonce` prints its body the first time that fragment is rendered during the request. Later includes of the same compiled fragment are skipped. Use it when a partial would otherwise emit the same `<script>` twice.

```html
@once
<script src="/assets/chart.js"></script>
@endonce
```

### Includes

`@include` renders another view and inserts the HTML. With one argument, the included view sees the current data. With two arguments, those keys are merged on top of the current data.

```html
@include('partials.alert') @include('partials.alert', { message: 'Saved' })
```

The view name is a string, using the same dot notation as `view()`.

### `@let`

`@let` assigns one local from a single expression. The name is a plain identifier. Statements and semicolons are rejected.

```html
@let(label = user.name.toUpperCase())
<h1>{{ label }}</h1>
```

## Components

A tag that starts with `<x-` renders a component. `<x-alert />` looks for a class registered as `alert`. When no class is registered, it renders `resources/views/components/alert.view`. Dots and slashes in the tag name become dots in the view name, so `<x-forms.input />` loads `resources/views/components/forms/input.view`.

### Passing data

Attributes become data. A quoted attribute is a string. An attribute with no value is the string `"true"`. Prefix the name with `:` to pass a JavaScript expression instead of a string.

```html
<x-alert type="info" :message="user.name" />
```

Inside `components/alert.view`, `type` and `message` are variables.

### Props and attributes

`@props` declares the data the component expects and fills in defaults when the caller omitted them. Everything else becomes an `attributes` bag.

```html title="resources/views/components/alert.view"
@props({ type: 'info', message: '' })
<div {!! attributes.merge({ class: 'alert-' + type }) !!}>
  {{ message }}
</div>
```

`attributes.merge` joins a `class` value onto an existing class and replaces other keys. `attributes.class('alert')` is `merge({ class: 'alert' })`. `attributes.get('id')` reads one leftover attribute. Print the bag with `{!! attributes !!}` so the quotes in the attribute string are not encoded again.

`@aware` copies named values from the parent view when the component did not receive them as attributes.

```html
@aware(['color'])
```

### Slots

The markup between the opening and closing tag is the slot. A self-closing tag has an empty slot. The slot is rendered in the parent, then passed to the component as the string `slot`.

```html
<x-alert type="info"> Saved <strong>{{ name }}</strong> </x-alert>
```

```html title="resources/views/components/alert.view"
<aside class="{{ type }}">{!! slot !!}</aside>
```

There is a default `slot` string. Named slots use `<x-slot:title>` or `<x-slot name="title">` and become extra props on the component (`title`, …).

### Class-based components

Register a class when the component needs a method or computed data. `render()` returns a view name. Public fields are passed into that view. Attributes from the tag are assigned onto the instance before `render()` runs.

```ts
import { Component, getViewFactory } from "@bunyad/view";

class Alert extends Component {
  type = "info";

  render() {
    return "components.alert";
  }
}

getViewFactory().component("alert", Alert);
```

The class takes priority over `components/alert.view` as the component entry. The view named by `render()` is still a normal template.

## Layouts

A layout is a view with `@yield` placeholders. A child view starts with `@extends` and fills those placeholders with `@section` / `@endsection`.

```html title="resources/views/layouts/app.view"
<html>
  <head>
    <title>{{ title }}</title>
    @stack('styles')
  </head>
  <body>
    @yield('content') @stack('scripts')
  </body>
</html>
```

```html title="resources/views/users/show.view"
@extends('layouts.app') @section('content')
<h1>{{ user.name }}</h1>
@endsection
```

`@extends` must be the start of the child. Each `@section('name')` runs until `@endsection`. `@yield('content')` is replaced with that section. A missing section may supply a default: `@yield('title', 'App')`.

`@push('scripts')` / `@endpush` appends markup to a stack. `@prepend('scripts')` / `@endprepend` inserts at the front. `@stack('scripts')` prints the stack. Stacks survive `@include` and components in the same render, so a partial can push a script and the layout can print it.

```html
@push('scripts')
<script src="/assets/app.js"></script>
@endpush
```

`@head` prints the tags registered by `@bunyad/head` when that package is booted. It prints nothing when no head renderer is registered.

## Forms

### CSRF field

State-changing forms must send the session token. `verifyCsrf()` checks `_token` on the body, or `X-CSRF-TOKEN` / `X-XSRF-TOKEN`. Prefer the `@csrf` directive (or `csrf_token()`). The route that renders the form must use the session middleware, or the helper has no token to read.

```html
<form method="POST" action="{{ route('profile.update') }}">
  @csrf
  <!-- ... -->
</form>
```

### Method spoofing

HTML forms only support `GET` and `POST`. Spoof `PUT`, `PATCH`, or `DELETE` with `@method`:

```html
<form method="POST" action="{{ route('profile.update') }}">
  @csrf
  @method('PUT')
  <!-- ... -->
</form>
```

### Validation errors

`@error('email')` / `@enderror` prints its body when `errors.email` is set on the view data. Inside the block, `message` is the first message for that field, whether the value is a string or an array of strings.

```html
<label for="email">Email</label>
<input id="email" name="email" value="{{ old('email') }}" />
@error('email')
<p>{{ message }}</p>
@enderror
```

`old('email')` reads `_old.email`, or the default you pass as the second argument. The default is an empty string. Validation failures on an HTML form flash `errors` and `_old` before redirecting back, and every view reads them from the session: the controller does not pass them. Data you pass explicitly wins, which is useful in tests or when you render a view without a redirect:

```ts
return view("users.create", {
  errors: { email: ["The email field is required."] },
  _old: { email: "ada@example.com" },
});
```

### A note on optional fields

A field marked `nullable` may be empty. Do not treat a missing old value as a validation error. `old('title', user.title)` keeps the stored value when the form is rendered for the first time and the flashed input is empty.

## Compiling views

Development recompiles from disk. Outside development, the factory compiles once and caches the function for the process. `clearCache()` drops that cache and any precompiled map so the next render reads the files again.

`setPreloadedViews` registers render functions before the factory boots. A binary build uses this so the executable does not need the `resources/views` directory. With `compiledOnly`, a missing name throws `BUNYAD_VIEW_001` instead of reading disk.

`bunyad compile` writes those functions. Run it as part of building a binary, not on every request.
