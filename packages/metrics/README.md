# @bunyad/metrics

Application metrics: record counts, sums and values, ingest them into a memory or Redis store, aggregate them, and serve an HTML and JSON dashboard.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/metrics@beta
# or: npm install @bunyad/metrics@beta
```

## Usage

```ts
import { Metrics } from "@bunyad/metrics";

Metrics.record("user_sale", "42", 10).sum().count(); // type, key, value + aggregators
Metrics.record("user_sale", "42", 5).sum().count();
Metrics.set("app_version", "current", "1.0.0");      // latest string value
await Metrics.ingest();                              // flush the buffer into the store

Metrics.aggregate("user_sale");
// [{ type: "user_sale", key: "42", count: 2, sum: 15, min: 5, max: 10, avg: 7.5 }]

Metrics.store().values("app_version")[0]!.value;     // "1.0.0"

Metrics.report(new Error("boom"));                   // records an "exception" entry
await Metrics.ingest();
Metrics.store().entries("exception").length;         // 1
```

Also: `Metrics.lazy(cb)`, `Metrics.filter(fn)`, `Metrics.ignore()`, `Metrics.html(title)`, `Metrics.fake()` for tests, and recorders (`RequestsRecorder`, `ExceptionsRecorder`, `ServersRecorder`). Mount the dashboard with `registerMetricsRoutes(router, { path, title })`, which serves HTML at `/metrics` and JSON at `/metrics/aggregates` by default.

## Notes

- Bun only (Bun 1.4 or newer).
- The default store is in-memory. `RedisMetricsStore` and `RedisMetricsIngest` take an injected client with `get`, `set` and `del`; with `RedisMetricsIngest`, entries are buffered by `ingest()` and drained into the store by `await Metrics.work()`.
- Depends on `@bunyad/router` (for the dashboard routes).

## License

MIT
