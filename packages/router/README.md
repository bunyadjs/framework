# @bunyad/router

Route registration, matching and URL generation for Bunyad, with named routes, groups, resource routes and a radix-tree matcher.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/router@beta   # or: npm install @bunyad/router@beta
```

## Usage

```ts
import { Router } from "@bunyad/router";
import { json } from "@bunyad/http";

const r = new Router();
r.get("/users/{id}", (req) => json({ id: req.route("id") })).name("users.show");
r.prefix("admin").name("admin.").group(() => {
  r.get("/dashboard", () => json({ ok: true })).name("dashboard");
});

r.match("GET", "/users/9")?.params;    // { id: "9" }
r.route("users.show", { id: 9 });      // "/users/9"
r.route("admin.dashboard");            // "/admin/dashboard"
r.match("GET", "/nope");               // undefined
```

## Notes

- Bun-only runtime.
- The package also exports a default `Route` facade, `url()`/`asset()`/`signed()` URL helpers, `resource()` routes and route-model binding hooks.
- Actions can be closures, `[Controller, "method"]` tuples or invokable classes (`__invoke`).
- Depends on `@bunyad/http`; use `@bunyad/core` to serve a router.

## License

MIT
