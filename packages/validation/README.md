# @bunyad/validation

Rule-string validation for Bunyad (`"required|email|min:8"`) with message bags, database presence rules and custom rules.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/validation@beta   # or: npm install @bunyad/validation@beta
```

## Usage

```ts
import { validate, ValidationException } from "@bunyad/validation";

const data = await validate(
  { email: "a@b.co", age: "30" },
  { email: "required|email", age: "required|integer|min:18" },
);
// { email: "a@b.co", age: 30 }  (validated values are cast, so age is a number)

try {
  await validate({ email: "nope" }, { email: "required|email", name: "required" });
} catch (e) {
  if (e instanceof ValidationException) e.errors;
  // { email: ["The email field must be a valid email address."],
  //   name: ["The name field is required."] }
}
```

## Notes

- Bun-only runtime.
- `validate()` accepts `{ attributes, messages, user }` as a third argument for custom field names, messages and the `current_password` rule.
- `unique` / `exists` rules need a verifier registered with `setPresenceVerifier()`; `Password`, `Can` and `CanAny` rules are also exported.
- Default messages are English (`enValidationMessages`); override with `setDefaultMessages()`.

## License

MIT
