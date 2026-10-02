# @bunyad/oauth

OAuth 2 social login for Bunyad with built-in GitHub, Google, Discord and GitLab providers and a base class for custom ones.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/oauth@beta   # or: npm install @bunyad/oauth@beta
```

## Usage

```ts
import { Request } from "@bunyad/http";
import { Session } from "@bunyad/session";
import { OAuth } from "@bunyad/oauth";

OAuth.config({
  github: {
    clientId: "gid",
    clientSecret: "secret",
    redirect: "http://localhost/auth/github/callback",
  },
});

const req = new Request(new globalThis.Request("http://localhost/login/github"));
req.session = new Session();
OAuth.setRequest(req);

const res = OAuth.driver("github").redirect();
res.status;                    // 302
res.headers.get("Location");   // https://github.com/login/oauth/authorize?client_id=gid&redirect_uri=...&state=...

// In the callback route: const user = await OAuth.driver("github").user();  // OAuthUser
```

## Notes

- Bun-only runtime.
- The `state` value is stored in the session and checked on callback, so `@bunyad/session` (a dependency) must be active on the request.
- Add providers with `OAuth.extend()` by subclassing `AbstractProvider`; `OAuth.setFetch()` swaps the HTTP client for tests.
- `OAuth.flush()` clears configuration and cached drivers.

## License

MIT
