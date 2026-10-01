# @bunyad/common

Shared utilities for [Bunyad](https://github.com/bunyadjs/framework) packages: `Collection`, `Str`/`Arr` helpers, `dataGet`/`dataSet`, pipelines, and `BunyadError`.

> **Alpha.** APIs may change between `0.x` releases.

```bash
npm install @bunyad/common@alpha
```

```ts
import { collect, dataGet } from "@bunyad/common";

collect([3, 1, 2]).sort().all(); // [1, 2, 3]
dataGet({ user: { name: "Ada" } }, "user.name"); // "Ada"
```

Works on Node 20+ and Bun.

## License

MIT
