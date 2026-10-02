# @bunyad/config

A dot-notation configuration repository with typed getters, plus a `config()` helper and a `Config` facade over a shared instance.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/config@beta
# or: npm install @bunyad/config@beta
```

## Usage

```ts
import { Config, ConfigRepository, config, setConfigInstance } from "@bunyad/config";

setConfigInstance(
  new ConfigRepository({ app: { name: "Bunyad", port: "3000" }, drivers: ["redis"] }),
);

config<string>("app.name");        // "Bunyad"
config("app.missing", "fallback"); // "fallback"
Config.integer("app.port");        // 3000 (string coerced)

Config.set("app.env", "local");
Config.get<string>("app.env");     // "local"
Config.has("app.debug");           // false

Config.push("drivers", "file");
Config.array("drivers");           // ["redis", "file"]
```

Typed getters: `string`, `integer`, `float`, `boolean`, `array`, `collection`. Also `getMany`, `prepend`, `push` and `all`. Use `new ConfigRepository(items)` directly when you don't want a shared instance.

## Notes

- Bun only (Bun 1.4 or newer).
- `config()` and `Config` read the instance registered with `setConfigInstance`; register one at boot.
- Depends on `@bunyad/common`.

## License

MIT
