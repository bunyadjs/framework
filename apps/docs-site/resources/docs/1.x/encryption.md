---
title: Encryption
description: Encrypt and decrypt strings with AES-256-GCM using your application key.
---

# Encryption

## Introduction

`Crypt` encrypts and decrypts UTF-8 strings with AES-256-GCM. Every ciphertext includes an authentication tag, so a modified payload fails decryption instead of returning garbage. Import it from `@bunyad/common`.

```ts
import { Crypt } from "@bunyad/common";

const payload = Crypt.encryptString("secret-token");
const plain = Crypt.decryptString(payload);
```

`encrypt` and `decrypt` are aliases of `encryptString` and `decryptString`. Use either pair; both expect and return strings.

## Configuration

Encryption is keyed by `APP_KEY`. Generate a key and put it in your environment before you encrypt anything in production:

```ts
import { Crypt } from "@bunyad/common";

const key = Crypt.generateKey();
// base64:… — copy this into APP_KEY
```

```env
APP_KEY=base64:your-generated-key-here
```

`generateKey()` returns a `base64:` string built from 32 random bytes. That is the form you should store in `.env`.

When `APP_KEY` starts with `base64:`, Bunyad decodes the rest. A decoded value of at least 32 bytes uses the first 32 as the AES key. Shorter decoded values, and any key without the `base64:` prefix, are passed through SHA-256 to produce a 32-byte key.

If `APP_KEY` is missing, encrypt and decrypt throw. Production messages tell you to generate a key with `Crypt.generateKey()`. Outside production the error still requires `APP_KEY` or an explicit override — there is no silent default key.

### Setting a key in tests

Prefer `APP_KEY` in real apps. In tests you may override the key for the process:

```ts
import { Crypt } from "@bunyad/common";

Crypt.setKey(Crypt.generateKey());

try {
  const payload = Crypt.encrypt("round-trip");
  Crypt.decrypt(payload); // "round-trip"
} finally {
  Crypt.clearKey();
}
```

`setKey(undefined)` and `clearKey()` restore reading from `APP_KEY`. `resolveAppKey()` from `@bunyad/common` returns the raw key string currently in use (override or env) and throws with the same rules when none is set.

:::warning
Changing `APP_KEY` makes every previously encrypted value undecryptable until you register the old keys with `Crypt.previousKeys`. Treat key rotation as a deliberate migration.
:::

## Rotating encryption keys

New values always encrypt with the current key. When decrypting, Bunyad tries the current key first, then any previous keys you registered:

```ts
import { Crypt } from "@bunyad/common";

Crypt.previousKeys([
  "base64:old-key-one=",
  "base64:old-key-two=",
]);

const plain = Crypt.decryptString(payloadEncryptedWithAnOldKey);
```

Call `previousKeys` once at boot (for example from a service provider) with the list of retired keys. Encryption continues to use only the current `APP_KEY`. After every stored value has been re-encrypted under the new key, you can clear the previous list by calling `previousKeys([])`.

## Encrypting a value

Pass the plain string to `encryptString` (or `encrypt`). The result is a base64 string: a 12-byte IV, a 16-byte GCM tag, and the ciphertext, concatenated and encoded.

```ts title="app/Http/Controllers/TokenController.ts"
import type { Request } from "@bunyad/http";
import { redirect } from "@bunyad/http";
import { Crypt } from "@bunyad/common";

export default class TokenController {
  async store(request: Request) {
    const user = request.user;
    if (!user) {
      return redirect("/login");
    }

    const token = String(request.input("token") ?? "");
    await user.fill({ token: Crypt.encryptString(token) }).save();

    return redirect("/secrets");
  }
}
```

Do not store the same secret twice and expect identical ciphertext. A fresh IV is chosen on every call.

## Decrypting a value

Pass the stored payload to `decryptString` (or `decrypt`). If the payload is truncated, not valid base64 layout for this format, or the tag does not match any registered key, decryption throws an `Error`:

```ts
import { Crypt } from "@bunyad/common";

try {
  const plain = Crypt.decryptString(encryptedValue);
} catch (error) {
  // Invalid or tampered payload, or wrong key
}
```

## Inspecting keys and payloads

`Crypt.supported(key)` returns whether a candidate key string looks usable (decoded or raw length 16, 24, or 32 bytes). The optional second argument is accepted for call-site compatibility and is ignored — the cipher is always AES-256-GCM.

```ts
const key = Crypt.generateKey();
Crypt.supported(key); // true
```

`Crypt.appearsEncrypted(value)` is a cheap shape check: a non-empty string whose base64 decoding is at least 28 bytes (IV + tag). It does not verify authenticity.

```ts
Crypt.appearsEncrypted(Crypt.encrypt("x")); // true
Crypt.appearsEncrypted("plain"); // false
```

`Crypt.getKey()` returns the active 32-byte key as a base64 string (without the `base64:` prefix used in `.env`). Use it for diagnostics in non-production environments, not as a substitute for keeping `APP_KEY` in config.

## Method reference

| Method | Role |
| --- | --- |
| `encryptString(value)` / `encrypt(value)` | Encrypt a UTF-8 string; returns base64 ciphertext |
| `decryptString(payload)` / `decrypt(payload)` | Decrypt a payload; tries current key, then `previousKeys` |
| `generateKey()` | Random `base64:…` value for `APP_KEY` |
| `setKey(key)` / `clearKey()` | Override or clear the in-process key (tests) |
| `getKey()` | Active key bytes as base64 |
| `previousKeys(keys)` | Retired keys tried on decrypt after the current key |
| `supported(key)` | Whether the key length looks valid |
| `appearsEncrypted(value)` | Whether the value looks like a Crypt payload |
| `resolveAppKey()` | Raw `APP_KEY` or override string (throws if unset) |

A short overview also lives on the [Helpers](/docs/1.x/helpers#crypt) page. This chapter is the full reference.
