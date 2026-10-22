# Hello world

```ts title="server.ts"
import { bunyad } from "@bunyad/framework";

export const createApplication = bunyad(import.meta);
```

```ts title="routes/hello/HelloController.ts"
export default class HelloController {
  handle() {
    return { message: "Hello" };   // GET /hello
  }
}
```

Run it with `bun server.ts`. The folder is the URL, so there is no route to register.

## Next to the others

The same endpoint (`GET /hello` returning `{ "message": "Hello" }`) in each framework:

| | Files | Lines | Shape |
| --- | --- | --- | --- |
| Hono | 1 | 4 | `app.get("/hello", (c) => c.json({ message: "Hello" }))` |
| Elysia | 1 | 3 | `new Elysia().get("/hello", () => ({ message: "Hello" })).listen(3000)` |
| Fastify | 1 | 5 | `app.get("/hello", async () => ({ message: "Hello" }))` and `listen` |
| Bunyad | 2 | 6 | `server.ts` boots the app, a controller in `routes/hello/` is the route |

Bunyad is the longest because the route lives in its own file. What it buys is that the same layout carries on to a real app without a rewrite: validation, auth rules, pages and layouts all have a fixed place, and nothing is registered in a central file. The benchmark folder has all four servers on the same scenarios (`bun benchmarks/competitors/compare.ts`). Three runs on one machine (i9-9980HK, Bun 1.4.2, 32 connections, 2 s per scenario), median of the three:

| req/s | Bunyad (file routes) | Bunyad (bare router) | Hono | Elysia | Fastify |
| --- | --- | --- | --- | --- | --- |
| static hello | 44,896 | 45,776 | 50,125 | 54,973 | 31,099 |
| param route | 45,841 | 45,893 | 47,441 | 52,220 | 32,233 |

A file-routed Bunyad app runs about as fast as the bare router, within about 10% of Hono on a static route and 3% on a param route. Results vary a few percent from run to run, so re-run it on your own machine before quoting numbers.
