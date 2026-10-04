# @bunyad/http

HTTP building blocks for Bunyad: a `Request` wrapper, response helpers, a middleware pipeline, form requests, JSON resources, cookies, CORS and rate limiting.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/http@beta   # or: npm install @bunyad/http@beta
```

## Usage

```ts
import { Request, json, abort, runPipeline, type Middleware } from "@bunyad/http";

const timing: Middleware = async (req, next) => {
  const res = await next(req);
  res.headers.set("X-Handled", "yes");
  return res;
};

const req = new Request(new globalThis.Request("http://localhost/users?page=2"), { id: "5" });
req.input("id");   // "5" (route params and query share `input`)
req.input("page"); // "2"

const res = await runPipeline(req, [timing], (r) => json({ id: r.input("id") }, 201));
res.status;                     // 201
res.headers.get("X-Handled");   // "yes"
await res.json();               // { id: "5" }

abort(404, "Not here"); // throws HttpException with status 404
```

## Rate limiting

`throttle` and `RateLimiter` use a sliding window (a weighted two-window counter), so a client cannot burst `2 × max` across a window boundary. Counters are per process by default; call `getRateLimiter().use(cache)` to share them across workers.

```ts
Route.post("/login", handler).middleware("throttle:5,1"); // 5 per minute, keyed by IP
```

- Blocked requests are not counted, so retrying does not extend the lockout.
- A 429 carries a `Retry-After` header and a body of `{ message, retry_after }`.
- `limiter.availableIn(key, maxAttempts)` returns the seconds until the next hit is allowed. Pass `maxAttempts` for an exact answer.

## Notes

- Bun-only runtime (Bun 1.4 or newer).
- Also exports `FormRequest`, `JsonResource`, `JsonApiResource`, `throttle`/`RateLimiter`, `handleCors`, `redirect`, `stream`/`eventStream`/`download` and the `@Middleware` decorator.
- Middleware can be a function, an alias string registered with `aliasMiddleware`, or an object with `handle`.

## License

MIT
