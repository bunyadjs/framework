# @bunyad/common

Shared utilities for [Bunyad](https://github.com/bunyadjs/framework) packages: `Collection`, `LazyCollection`, `Str`/`Arr` helpers, `dataGet`/`dataSet`, pipelines, and `BunyadError`.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
npm install @bunyad/common@beta
```

```ts
import { collect, dataGet } from "@bunyad/common";

collect([3, 1, 2]).sort().all(); // [1, 2, 3]
dataGet({ user: { name: "Ada" } }, "user.name"); // "Ada"
```

Works on Node 20+ and Bun.

## License

MIT
