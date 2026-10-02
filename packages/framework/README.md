# @bunyad/framework

The Bunyad framework in one package: an opinionated default stack that re-exports the application core, HTTP, routing, auth, database and ORM, queue, mail, notifications, cache, sessions, views, validation and more, plus default service providers and compiler plugins.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/framework@beta
# or: npm install @bunyad/framework@beta
```

New apps are better started with `bunx create-bunyad@beta my-app`, which wires this package up for you.

## Usage

```ts
import { Application, createFetchHandler, json, defaultCompilerPlugins } from "@bunyad/framework";

const app = new Application({ config: { app: { port: 0 } } });
app.router.get("/hello", () => json({ hello: "world" }));
await app.boot();

// The same fetch handler `serve()` uses, called in-process.
const res = await createFetchHandler(app)(new Request("http://localhost/hello"));
console.log(res.status, await res.json()); // 200 { hello: "world" }

// Plugins the compiler needs for a production build.
console.log(
  defaultCompilerPlugins({ routesEntry: "./routes/web.ts", applicationModule: "./bootstrap/app.ts" }).map((p) => p.name),
); // [ "router", "middleware", "providers", "discovery", "config", "server" ]
```

## Notes

- Runs on Bun only (1.4 or newer).
- Importing it registers the default middleware aliases (`auth`, `guest`, `can`, `throttle`, `signed`, `verified`) and the full-stack global helpers.
- Apps can still depend on individual `@bunyad/*` packages instead; this package just re-exports them and pins a compatible set.
- Includes service providers for auth, broadcasting, cache, database, events, features, filesystem, head, HTTP, inertia, live, log, mail, notifications, queue, sessions and views.

## License

MIT
