# @bunyad/inertia

Server-side adapter for Inertia.js pages in Bunyad: page objects, shared props, lazy/deferred/merge props, asset versioning and optional SSR.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/inertia@beta   # or: npm install @bunyad/inertia@beta
```

## Usage

```ts
import { Request } from "@bunyad/http";
import { Inertia } from "@bunyad/inertia";

Inertia.version("v1");
Inertia.share("appName", "Bunyad");

const req = new Request(
  new globalThis.Request("http://localhost/users", { headers: { "X-Inertia": "true" } }),
);
const res = await Inertia.render("Users/Index", { users: [{ id: 1 }] }).toResponse(req);

res.headers.get("X-Inertia"); // "true"
await res.json();
// { component: "Users/Index", props: { appName: "Bunyad", users: [{ id: 1 }] },
//   url: "/users", version: "v1", sharedProps: ["appName"], ... }
// A request without X-Inertia gets a full HTML document (text/html) instead.
```

## Notes

- Bun-only runtime.
- Add `handleInertiaRequests` (or subclass `Middleware`) to handle version mismatches, shared props and validation errors.
- Prop wrappers: `LazyProp`, `OptionalProp`, `DeferProp`, `MergeProp`, `OnceProp`, `ScrollProp`, `AlwaysProp`.
- The HTML shell uses a view set with `Inertia.setRootView("app")` (rendered by `@bunyad/view`), otherwise a built-in document. SSR is configured with `configureSsr()`.

## License

MIT
