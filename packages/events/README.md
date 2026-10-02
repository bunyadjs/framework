# @bunyad/events

A typed event dispatcher with class and string events, queued listeners, subscribers and a test fake.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/events@beta
# or: npm install @bunyad/events@beta
```

## Usage

```ts
import { Dispatcher, Event, event, setEventDispatcher } from "@bunyad/events";

class UserRegistered extends Event {
  constructor(readonly email: string) { super(); }
}

const dispatcher = new Dispatcher();
setEventDispatcher(dispatcher);

dispatcher.listen(UserRegistered, (e) => console.log(`welcome ${e.email}`));
dispatcher.listen("order.placed", (payload) => console.log("order", payload));

await event(new UserRegistered("ada@example.com")); // welcome ada@example.com
await dispatcher.dispatchAs("order.placed", { id: 9 }); // order { id: 9 }

// In tests: record dispatches without running listeners
const fake = Event.fake();
await event(new UserRegistered("bob@example.com"));
Event.assertDispatched(UserRegistered);
Event.assertDispatchedTimes(UserRegistered, 1);
fake.restore();
```

Also available: `listenOnce`, `subscribe` (subscriber classes), `ShouldDispatchAfterCommit`, and `{ queued: true }` listeners.

## Notes

- Bun only (Bun 1.4 or newer).
- Queued listeners need a queue pusher: `new Dispatcher({ queue: async (listener, event) => { ... } })`.
- `event()` and the static `Event.*` helpers use the dispatcher registered with `setEventDispatcher`.
- Depends on `@bunyad/container` and `@bunyad/database`.

## License

MIT
