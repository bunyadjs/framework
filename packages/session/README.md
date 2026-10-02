# @bunyad/session

Cookie-based HTTP sessions with flash data and memory, file, Redis and database stores, delivered as a `@bunyad/http` middleware.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/session@beta
# or: npm install @bunyad/session@beta
```

## Usage

```ts
import { Request, json, runPipeline } from "@bunyad/http";
import { MemorySessionStore, startSession } from "@bunyad/session";

const mw = startSession({ store: new MemorySessionStore(), lifetime: 120 });

const first = new Request(new globalThis.Request("http://localhost/"));
const res = await runPipeline(first, [mw], async () => {
  first.session!.put("visits", 1);
  first.session!.flash("notice", "Saved");
  return json({ ok: true });
});
const cookie = res.headers.get("Set-Cookie")!.split(";")[0]; // "bunyad_session=<id>"

const second = new Request(
  new globalThis.Request("http://localhost/", { headers: { cookie } }),
);
await runPipeline(second, [mw], async () => {
  second.session!.get("visits");  // 1
  second.session!.get("notice");  // "Saved" (flash survives one more request)
  return json({ ok: true });
});
```

`Session` also offers `pull`, `push`, `increment`, `forget`, `flush`, `regenerate`, `token` and `previousUrl`. Other stores: `FileSessionStore({ path })`, `RedisSessionStore({ url, prefix })`, `DatabaseSessionStore`, and `EncryptedSessionStore`. `SessionManager` selects a named driver.

## Notes

- Bun only (Bun 1.4 or newer).
- `lifetime` is in minutes and sets the cookie `Max-Age`. Cookie options: `cookie` (default `bunyad_session`), `secure`, `domain`, `sameSite` (default `Lax`).
- Anonymous JSON requests that never touch the session do not set a cookie.
- Call `setSessionStore()` once at boot to omit `store` from `startSession()`.
- `RedisSessionStore` uses Bun's built-in `RedisClient`; no extra driver is needed.
- Depends on `@bunyad/http`, `@bunyad/cache`, `@bunyad/common` and `@bunyad/contracts`.

## License

MIT
