---
title: Hashing
description: Hash and verify passwords with bcrypt or argon2id.
---

# Hashing

## Introduction

`Hash` stores passwords as one-way digests. You hash on registration or password change, then verify the plain text on login. Import it from `@bunyad/auth`. By default Bunyad uses bcrypt through Bun's password API. Argon2id is available when you ask for it.

```ts
import { Hash } from "@bunyad/auth";

const hashed = await Hash.make("secret");
const ok = await Hash.check("secret", hashed);
```

`make` and `check` are asynchronous. Always `await` them.

Bcrypt's work factor is adjustable. A higher cost makes hashing slower for everyone — including an attacker trying every candidate password. The default cost of `10` is appropriate for most apps.

## Configuration

There is no separate hashing config file. The default algorithm is bcrypt. The default cost is `10`. Change the process-wide bcrypt cost with `setRounds`:

```ts
import { Hash } from "@bunyad/auth";

Hash.setRounds(12);
Hash.cost(); // 12
Hash.rounds(); // 12 — alias of cost()
```

`setRounds` returns `Hash`, so you can chain it. `verifyConfiguration` checks that a cost sits in bcrypt's valid range (4–31):

```ts
Hash.verifyConfiguration({ cost: 12 }); // true
Hash.verifyConfiguration({ cost: 2 }); // false
```

Pass `cost` (and optionally `algorithm`) on individual `make` / `needsRehash` calls when you need a one-off override without changing the process default.

## Hashing passwords

Call `make` with the plain-text password:

```ts title="app/Http/Controllers/PasswordController.ts"
import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Hash } from "@bunyad/auth";

export default class PasswordController {
  async update(request: Request) {
    const user = request.user;
    if (!user) {
      return redirect("/login");
    }

    const newPassword = String(request.input("newPassword") ?? "");
    await user.fill({ password: await Hash.make(newPassword) }).save();

    return redirect("/profile");
  }
}
```

### Adjusting the bcrypt cost

Pass `cost` in the options object. If you omit it, `make` uses the value from `setRounds` (default `10`):

```ts
const hashed = await Hash.make("password", {
  cost: 12,
});
```

### Using argon2id

Set `algorithm` to `"argon2id"` when you want Argon2id instead of bcrypt:

```ts
const hashed = await Hash.make("password", {
  algorithm: "argon2id",
});
```

Bun chooses Argon2id parameters. There are no `memory`, `time`, or `threads` options on `Hash.make`.

### The `bcrypt` helper

`bcrypt` from `@bunyad/auth` is a thin wrapper around `Hash.make` with the bcrypt algorithm. An optional second argument sets the cost for that call:

```ts
import { bcrypt } from "@bunyad/auth";

const hashed = await bcrypt("secret");
const expensive = await bcrypt("secret", 12);
```

Framework apps that call `installGlobals()` also expose `bcrypt` on `globalThis`. Prefer the import when the call site should stay explicit.

## Verifying a password

`check` compares plain text to a stored hash. It returns `true` when they match:

```ts
if (await Hash.check("plain-text", hashedPassword)) {
  // The passwords match
}
```

Verification accepts bcrypt and Argon2 hashes that Bun can verify. Algorithm selection for `check` comes from the hash string itself, not from a config driver.

## Determining if a password needs to be rehashed

`needsRehash` returns `true` when the stored hash does not match the algorithm and options you expect. Apps often run this after a successful login and rewrite the column when the work factor has changed:

```ts
if (await Hash.check(plain, hashed) && Hash.needsRehash(hashed)) {
  user.password = await Hash.make(plain);
  await user.save();
}
```

For bcrypt (the default), `needsRehash` is `true` when the value does not look like a bcrypt hash, or when the embedded cost differs from `options.cost` / the current `setRounds` value:

```ts
Hash.needsRehash(hashed); // false if cost matches default
Hash.needsRehash(hashed, { cost: 4 }); // true when the hash used a different cost
```

For `algorithm: "argon2id"`, the hash must start with `$argon2id$` or it needs rehashing.

## Inspecting hashes

`isHashed` reports whether a string looks like a bcrypt or Argon2 digest:

```ts
Hash.isHashed(hashed); // true for $2… or $argon2…
Hash.isHashed("plain"); // false
```

`info` returns algorithm metadata shaped for inspection:

```ts
const meta = Hash.info(hashed);
// bcrypt: { algo: 1, algoName: "bcrypt", options: { cost: 10 } }
// argon2id: { algo: 2, algoName: "argon2id", options: {} }
// unknown: { algo: 0, algoName: "unknown", options: {} }
```

`isUsingCorrectAlgorithm` checks that the hash matches the algorithm you intend (`bcrypt` or `argon2id`). `isUsingValidOptions` combines that check with `needsRehash` — it is `true` only when the algorithm matches and the hash does not need rehashing:

```ts
Hash.isUsingCorrectAlgorithm(hashed); // bcrypt prefix by default
Hash.isUsingCorrectAlgorithm(hashed, { algorithm: "argon2id" });

Hash.isUsingValidOptions(hashed, { cost: 10 });
```

## Method reference

| Method | Role |
| --- | --- |
| `make(value, options?)` | Hash a plain string (`Promise<string>`) |
| `check(value, hashed)` | Verify plain text against a hash (`Promise<boolean>`) |
| `needsRehash(hashed, options?)` | Whether cost / algorithm no longer match |
| `isHashed(value)` | Whether the string looks like a password hash |
| `info(hashed)` | Algorithm name and options for a hash |
| `setRounds(n)` | Set the default bcrypt cost; returns `Hash` |
| `cost()` / `rounds()` | Current default bcrypt cost |
| `verifyConfiguration(options?)` | Whether `cost` is in 4–31 |
| `isUsingCorrectAlgorithm(hashed, options?)` | Prefix matches the chosen algorithm |
| `isUsingValidOptions(hashed, options?)` | Correct algorithm and no rehash needed |
| `bcrypt(value, cost?)` | Helper that hashes with bcrypt |

`HashOptions` accepts `algorithm?: "bcrypt" | "argon2id"` and `cost?: number`. `HashInfo` is the return type of `info`.
