---
title: Events
description: Dispatch domain events, register listeners and subscribers, and assert dispatches in tests.
---

# Events

## Introduction

Events let one part of your application announce that something happened without knowing who will react. A single event can have many listeners. For example, when a user registers you might send a welcome email and write an audit row — each as its own listener on the same `UserRegistered` event.

Event classes live under `app/Events`. Listeners live under `app/Listeners`. Framework apps get a default dispatcher from `EventServiceProvider`, so `Event.listen`, `Event.dispatch`, and `event()` work as soon as the application boots.

```ts
import { event } from "@bunyad/events";
import UserRegistered from "@/Events/UserRegistered.ts";

await event(new UserRegistered(user));
```

## Generating events and listeners

```shell
bunyad make:event UserRegistered
bunyad make:listener SendWelcomeEmail
```

`make:event` writes `app/Events/UserRegistered.ts` that extends `Event`. `make:listener` writes an async function under `app/Listeners`. Pass `--force` to overwrite an existing file.

## Registering events and listeners

Register listeners in a service provider `boot` method — typically `AppServiceProvider`:

```ts
import { ServiceProvider } from "@bunyad/core";
import { Event } from "@bunyad/events";
import UserRegistered from "@/Events/UserRegistered.ts";
import SendWelcomeEmail from "@/Listeners/SendWelcomeEmail.ts";

export default class AppServiceProvider extends ServiceProvider {
  boot(): void {
    Event.listen(UserRegistered, SendWelcomeEmail);
  }
}
```

You can pass a closure instead of an imported listener:

```ts
Event.listen(UserRegistered, (e) => {
  console.log(e.user.email);
});
```

Register the same listener for several events by passing an array:

```ts
Event.listen([OrderShipped, OrderDelivered], handleOrderUpdate);
```

`Event.listenOnce` removes the listener after it runs once.

### String and wildcard names

Named string events take a payload object. Wildcards use `*` (and `*` alone matches every string name):

```ts
Event.listen("order.placed", (payload) => {
  // ...
});

Event.listen("order.*", (payload) => {
  // ...
});
```

Dispatch string events with `dispatchAs`:

```ts
import { getEventDispatcher } from "@bunyad/events";

await getEventDispatcher().dispatchAs("order.placed", { id: 9 });
```

`hasListeners`, `getListeners`, `getWildcardListeners`, and `getRawListeners` inspect the map. `forget(event)` removes listeners for one event or wildcard pattern. `Event.flush()` with no arguments clears every listener.

## Defining events

Extend `Event` and put the data you need on the instance:

```ts
import type { Authenticatable } from "@bunyad/auth";
import { Event } from "@bunyad/events";

export default class UserRegistered extends Event {
  constructor(readonly user: Authenticatable) {
    super();
  }
}
```

Plain objects also work as events. The dispatcher keys class events by constructor, so prefer a named class when you want typed listeners.

## Defining listeners

A listener may be a function or a class with a `handle` method (instance or static). Class listeners are constructed with `app.make` when a container is available, otherwise `new Listener()`:

```ts
import type UserRegistered from "@/Events/UserRegistered.ts";
import { notify } from "@bunyad/notifications";
import WelcomeNotification from "@/Notifications/WelcomeNotification.ts";

export default class SendWelcomeEmail {
  async handle(event: UserRegistered): Promise<void> {
    await notify(event.user, new WelcomeNotification());
  }
}

Event.listen(UserRegistered, SendWelcomeEmail);
```

Function listeners still work:

```ts
export default async function SendWelcomeEmail(
  event: UserRegistered,
): Promise<void> {
  await notify(event.user, new WelcomeNotification());
}
```

Listeners run in registration order. Async listeners are awaited before the next one starts.

## Queued listeners

Pass `{ queued: true }` when you register a listener. The dispatcher hands that listener and the event to a `queue` callback instead of running it inline:

```ts
import { Dispatcher, setEventDispatcher } from "@bunyad/events";

const dispatcher = new Dispatcher({
  queue: async (listener, ev) => {
    // Push a job that later calls await listener(ev)
    await listener(ev);
  },
});

setEventDispatcher(dispatcher);

dispatcher.listen(UserRegistered, SendWelcomeEmail, { queued: true });
```

The framework `EventServiceProvider` installs a plain `Dispatcher` with no queue. Live a `QueuePusher` yourself when you want queued listeners. Without a queue configured, dispatching an event that has a queued listener throws.

## Dispatching events

Use the `event` helper or `Event.dispatch`. Both return the event instance after listeners finish (or immediately when deferred with `afterCommit`):

```ts
import { Event, event } from "@bunyad/events";
import UserRegistered from "@/Events/UserRegistered.ts";

await event(new UserRegistered(user));
await Event.dispatch(new UserRegistered(user));
```

### After database commit

Hold an event until the outermost DB transaction commits. Use any of:

- `Event.dispatch(event, { afterCommit: true })`
- `afterCommit = true` on the event instance or class
- extend `ShouldDispatchAfterCommit`

```ts
import { Event, ShouldDispatchAfterCommit } from "@bunyad/events";

class OrderPaid extends ShouldDispatchAfterCommit {
  constructor(readonly orderId: number) {
    super();
  }
}

await DB.transaction(async () => {
  await Event.dispatch(new OrderPaid(1));
  // listeners have not run yet
});
// listeners run after commit
```

With no open transaction, after-commit events dispatch on the next microtask (same as `DB.afterCommit`).

### Halting listeners

`until` runs listeners until one returns a non-null, non-undefined value, then stops and returns that value:

```ts
Event.listen(UserRegistered, () => null);
Event.listen(UserRegistered, () => "handled");
Event.listen(UserRegistered, () => "never");

const result = await Event.until(new UserRegistered(user));
// result === "handled"
```

`untilAs` does the same for string event names.

### Pushing events for later

`push` queues a named event without dispatching it. Flush one name or everything that was pushed:

```ts
Event.push("order.shipped", { id: 3 });

Event.listen("order.shipped", (p) => {
  // ...
});

await Event.flush("order.shipped");
await Event.flushPushed();
Event.forgetPushed();
```

`Event.flush("name")` dispatches pushed events with that name. `Event.flush()` with no arguments clears listeners (it does not flush the push queue).

### Deferring dispatches

`Event.defer` collects dispatches that happen inside the callback and runs them after the callback completes. If the callback throws, those deferred events are discarded:

```ts
await Event.defer(async () => {
  await event(new UserRegistered(user));
  // listeners have not run yet
});
// listeners run here
```

## Event subscribers

A subscriber groups several listeners. Implement `subscribe` and either register on the dispatcher argument or return a map / array of event-to-listener pairs:

```ts
import type { Dispatcher, EventSubscriber } from "@bunyad/events";
import { Event } from "@bunyad/events";
import UserRegistered from "@/Events/UserRegistered.ts";
import OrderShipped from "@/Events/OrderShipped.ts";

class UserEventSubscriber implements EventSubscriber {
  subscribe(events: Dispatcher): void {
    events.listen(UserRegistered, (e) => this.onRegister(e));
    events.listen(OrderShipped, (e) => this.onShipped(e));
  }

  onRegister(e: UserRegistered): void {
    // ...
  }

  onShipped(e: OrderShipped): void {
    // ...
  }
}

Event.subscribe(UserEventSubscriber);
// or Event.subscribe(new UserEventSubscriber());
```

Returning a map uses string keys (class `name` for class events, or a string event name). Returning an array of `[event, listener]` pairs can use class constructors. A string listener value is a method name on the subscriber instance.

## Broadcasting

Events that should reach browsers extend `ShouldBroadcast` from `@bunyad/broadcasting`. That class itself extends `Event`. Send them with `broadcast()` or `Broadcast.event()` — not with `event()`. Domain listeners and client broadcasts are separate paths. See [Broadcasting](/docs/1.x/broadcasting).

```ts
import { broadcast } from "@bunyad/broadcasting";
import OrderShipped from "@/Events/OrderShipped.ts";

await broadcast(new OrderShipped(42));
```

You can still `Event.listen(OrderShipped, …)` and `event(new OrderShipped(…))` for in-process listeners if you need both.

## Custom dispatchers

`EventServiceProvider` calls `setEventDispatcher(new Dispatcher())` during `register`. For a standalone script or a custom queue hook, create your own:

```ts
import { Dispatcher, setEventDispatcher } from "@bunyad/events";

setEventDispatcher(new Dispatcher({ queue: myQueuePusher }));
```

`getEventDispatcher()` returns the current instance.

## Testing

`Event.fake()` swaps in a recording dispatcher. Listeners do not run for faked events. Assert with the static helpers, then `restore()`:

```ts
import { Event, event } from "@bunyad/events";
import UserRegistered from "@/Events/UserRegistered.ts";

const fake = Event.fake();

await event(new UserRegistered(user));

Event.assertDispatched(UserRegistered);
Event.assertDispatched(UserRegistered, (e) => e.user.id === user.id);
Event.assertDispatchedTimes(UserRegistered, 1);
Event.assertNotDispatched("order.placed");
Event.assertListening(UserRegistered); // true if a real listener was registered before the fake

fake.restore();
```

`Event.assertNothingDispatched()` fails if any class or named event was recorded while the fake was active.

Pass an array to fake only those events; other dispatches still go to the previous dispatcher:

```ts
const fake = Event.fake([UserRegistered]);
await event(new UserRegistered(user)); // recorded, listeners skipped
await getEventDispatcher().dispatchAs("order.placed", { id: 1 }); // runs for real
fake.restore();
```

`assertListening` also sees listeners on the previous dispatcher while a fake is active.
