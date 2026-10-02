# @bunyad/live

Server-driven interactive components for Bunyad: `LiveComponent` classes whose state travels in a signed snapshot and whose public methods become client actions.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/live@beta   # or: npm install @bunyad/live@beta
```

## Usage

```ts
import { Live, LiveComponent } from "@bunyad/live";

class Counter extends LiveComponent {
  count = 0;
  increment() { this.count += 1; }
  html() {
    return `<span>${this.count}</span><button data-action="increment">+</button>`;
  }
}
Live.component("counter", Counter);

const html = await Live.mount("counter"); // wrapper div with data-live="counter" and a signed data-snapshot
const snapshot = JSON.parse(
  Buffer.from(html.match(/data-snapshot="([^"]+)"/)![1]!, "base64").toString("utf8"),
);

const result = await Live.update({ name: "counter", snapshot, calls: [{ method: "increment" }] });
result.html;          // <div ...><span>1</span><button ...>+</button></div>
result.snapshot.data; // { count: 1 }
```

## Notes

- Bun-only runtime.
- Snapshots are signed with `APP_KEY` (required whenever `APP_ENV`/`NODE_ENV` is `production` or unset, otherwise `Live.mount` throws); a tampered snapshot is rejected with a checksum error.
- Only public methods other than `html()` are callable; `data-model` inputs send property updates through `updates`.
- `Live.routes()`, `clientScript()` and `LiveController` wire the HTTP endpoint and browser script.

## License

MIT
