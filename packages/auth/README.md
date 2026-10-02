# @bunyad/auth

Authentication and authorization for Bunyad: session and token guards, password hashing, HS256 JWTs, gates and policies, CSRF protection, email verification and two-factor (TOTP).

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/auth@beta   # or: npm install @bunyad/auth@beta
```

## Usage

```ts
import { Hash, Jwt, generateSecretKey, totp, verifyTotp } from "@bunyad/auth";

const hashed = await Hash.make("secret");
await Hash.check("secret", hashed); // true
await Hash.check("wrong", hashed);  // false

const token = Jwt.encode({ sub: "42" }, "app-key");
Jwt.decode<{ sub: string }>(token, "app-key"); // { sub: "42" }
Jwt.decode(token, "other");                    // throws "Invalid JWT signature."

const secret = generateSecretKey();            // 32 base32 characters
verifyTotp(secret, totp(secret)) !== false;    // true
```

## Notes

- Bun-only runtime.
- Guards: `SessionGuard` (cookie sessions) and `TokenGuard` (the "token" guard, with `HasApiTokens`). Middleware helpers: `auth`, `guest`, `can`, `verified`, `confirmPassword`, `preventRequestForgery`.
- Authorization: `Gate.define()`, `Gate.policy()`, `Gate.allows(request, ability, model)` and `authorize()`.
- Guards read `request.session`; `@bunyad/session` provides it. `uqr` (bundled dependency) renders the two-factor QR code.

## License

MIT
