# @bunyad/features

Feature flags with boolean or resolver definitions, per-scope values, persistent stores and an HTTP middleware guard.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/features@beta
# or: npm install @bunyad/features@beta
```

## Usage

```ts
import { Feature } from "@bunyad/features";

Feature.define("new-api", false);
Feature.define("beta", (scope: unknown) => (scope as { id: number } | null)?.id === 1);
Feature.define("purchase-button", () => "seafoam-green"); // rich value

await Feature.active("new-api");               // false
await Feature.activate("new-api");
await Feature.active("new-api");               // true

await Feature.for({ id: 1 }).active("beta");   // true
await Feature.for({ id: 2 }).active("beta");   // false

await Feature.value("purchase-button");        // "seafoam-green"
await Feature.when("new-api", () => "on", () => "off"); // "on"
```

Also: `deactivate`, `forget` (re-resolve from the definition), `purge`, and `Feature.fake()` for tests. Guard routes with `ensureFeaturesAreActive("dash")`, which throws an `HttpException` with status 400 when a feature is off.

## Notes

- Bun only (Bun 1.4 or newer).
- Resolved values are remembered by the active store: `ArrayFeatureStore` (in-memory) by default, or `DatabaseFeatureStore` for persistence; use `setFeatures(new FeatureManager(...))` to swap.
- Any value other than `false` counts as active, so rich values (strings, objects) are "on".
- Depends on `@bunyad/http`.

## License

MIT
