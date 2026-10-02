# @bunyad/console

An interactive REPL for Bunyad apps that evaluates expressions and statements with top-level `await` and exposes a context to the session.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/console@beta
# or: npm install @bunyad/console@beta
```

## Usage

```ts
import { startConsole } from "@bunyad/console";

const users = [{ id: 1, name: "Ada" }];

await startConsole({
  banner: "Bunyad console. Type .exit to quit.",
  prompt: "bunyad> ",
  context: { users }, // each key becomes a global in the session
});
```

```text
Bunyad console. Type .exit to quit.
bunyad> users.length + 1
2
bunyad> users[0].name
'Ada'
bunyad> .exit
Bye.
```

Lines starting with `const`, `let`, `await`, `for`, etc. run as statements; anything else is evaluated and printed as an awaited expression.

## Notes

- Bun only (Bun 1.4 or newer).
- Options: `prompt`, `banner`, `context`, `input`, `output`, `print` (the last three make it testable with in-memory streams).
- `context` values are written onto `globalThis`.

## License

MIT
