# @bunyad/view

Bunyad's template engine, Views: `.view` files compiled once to functions and cached, with `@foreach`/`@if` directives, components, layouts and HTML-escaped output.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/view@beta   # or: npm install @bunyad/view@beta
```

## Usage

```ts
import { ViewFactory, setViewFactory, view } from "@bunyad/view";

// views/page.view
//   <h1>{{ title }}</h1>
//   @use('money')
//   @foreach(users as user)
//     <li>{{ user.name }} - {{ money.format(user.balance) }}</li>
//   @endforeach
//   <script>window.boot = @json(boot)</script>

const factory = new ViewFactory("./views");
factory.use("money", { format: (n: number) => `$${n.toFixed(2)}` });
setViewFactory(factory);

const res = view("page", { title: "Team <b>", users: [{ name: "Ada", balance: 12 }], boot: { a: 1 } });
res.headers.get("Content-Type"); // "text/html; charset=utf-8"
await res.text();
// <h1>Team &lt;b&gt;</h1>
//   <li>Ada - $12.00</li>
// <script>window.boot = {"a":1}</script>
```

## Notes

- Bun-only runtime.
- Templates have no `$` and no `@php`: script blocks and module imports are rejected. Register shared helpers with `factory.use(name, value)`, then `@use('name')`.
- Use `{{ }}` for escaped output, `{!! !!}` for raw HTML and `@json(...)` for HTML-safe JSON inside `<script>`.
- `render(name, data)` returns a string; `view(name, data)` returns an HTML `Response`. `createViewPlugin()` precompiles views for `@bunyad/compiler`.

## License

MIT
