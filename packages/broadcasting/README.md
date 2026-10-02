# @bunyad/broadcasting

Event broadcasting for Bunyad with swappable drivers: in-process sync, server-sent events, Pusher, Ably, log and null, plus channel authorization and presence.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/broadcasting@beta   # or: npm install @bunyad/broadcasting@beta
```

## Usage

```ts
import { ShouldBroadcast, SyncBroadcaster, broadcast, setBroadcaster } from "@bunyad/broadcasting";

class OrderShipped extends ShouldBroadcast {
  constructor(readonly orderId: number) { super(); }
  broadcastOn() { return `orders.${this.orderId}`; }
  broadcastAs() { return "order.shipped"; }
}

const driver = new SyncBroadcaster();
setBroadcaster(driver);
driver.listen("orders.9", (event, payload) => console.log(event, payload));

await broadcast(new OrderShipped(9));
// order.shipped { orderId: 9 }
```

## Notes

- Bun-only runtime.
- Drivers: `SyncBroadcaster`, `SseBroadcaster` (with `SseHub`), `PusherBroadcaster`, `AblyBroadcaster`, `LogBroadcaster`, `NullBroadcaster`. Select them through `BroadcastManager`.
- Channel authorization lives in `ChannelManager`; presence has Redis-backed stores and fan-out.
- Queued broadcasting integrates with `@bunyad/queue` (supplied by your app); `@bunyad/events` is a regular dependency.

## License

MIT
