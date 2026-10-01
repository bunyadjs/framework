# @bunyad/view

Laravel-like **Views** (we do not use the name Blade). No `$` in templates.

```ts
return view("welcome", { title: "Welcome", users });
```

```view
<h1>{{ title }}</h1>
@foreach(users as user)
  <li>{{ user.name }}</li>
@endforeach
```

## Logic in templates (secure)

**There is no `@php`.** Arbitrary script blocks and filesystem/module imports from templates are rejected.

| Need | Do this |
|------|---------|
| Shared helpers / formatters | Register in a provider: `getViewFactory().use('money', helper)` then `@use('money')` or `@import('money', 'fmt')` |
| Local binding | `@let(total = price * qty)` — one data-scoped expression only |
| JSON for `<script>` | `@json(payload)` — HTML-safe encoding |
| Heavy logic | Controllers, view composers, or class Components |

```ts
// app/Providers/AppServiceProvider.ts
getViewFactory().use("money", {
  format(n: number) {
    return new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency: "PKR",
    }).format(n);
  },
});
```

```view
@use('money')
@let(total = order.total)
<p>{{ money.format(total) }}</p>
<script>window.boot = @json(boot)</script>
```

Templates compile once and are cached for the request path.
