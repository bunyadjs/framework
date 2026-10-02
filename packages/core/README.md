# @bunyad/core

Application kernel for Bunyad: the `Application` container, service providers, the HTTP kernel and fetch handler, exception rendering, a Bun server, graceful shutdown and worker launching.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/core@beta   # or: npm install @bunyad/core@beta
```

## Usage

```ts
import { Application, createFetchHandler, serve } from "@bunyad/core";
import { Router } from "@bunyad/router";
import { json } from "@bunyad/http";

const router = new Router();
router.get("/", () => json({ hello: "world" }));

const app = new Application({ router, config: { app: { port: 0 } } });
await app.boot();

const fetch = createFetchHandler(app);
const res = await fetch(new Request("http://localhost/"));
res.status;        // 200
await res.json();  // { hello: "world" }

const server = serve(app, { port: 0, development: false }); // prints "Server running on [http://localhost:<port>]"
server.stop(true);
```

## Notes

- Bun-only runtime.
- Extend `ServiceProvider` to register and boot services; `ApplicationBuilder` configures routing, middleware and exceptions fluently.
- `serve()` listens on `app.port` (default 3000), installs shutdown handlers and, in development, live-reloads `.view` changes.
- Importing the package also installs HTTP, view, routing and config helpers on `globalThis`.

## License

MIT
