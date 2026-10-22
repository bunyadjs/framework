---
title: Broadcasting
description: Push events to browsers over SSE, Pusher, or Ably, with private and presence channel auth.
---

# Broadcasting

## Introduction

Broadcasting sends a named event and a JSON payload to one or more channels. A browser that is subscribed to those channels receives the event without polling. Use it for live order status, chat presence, or any update that should appear as soon as it happens on the server.

Events that should go to clients extend `ShouldBroadcast`. You send them with `broadcast()` or `Broadcast.event()`. Channel authorization lives in `routes/channels.ts`. The default transport in a framework app is server-sent events (SSE). Pusher Channels and Ably are available when you set their credentials.

## Configuration

Framework apps read `config/broadcasting.ts`. The default driver is `BROADCAST_DRIVER`, or `sse` when that variable is unset:

```ts
export default {
  default: process.env.BROADCAST_DRIVER ?? "sse",
  presence: process.env.PRESENCE_DRIVER,
  fanout: process.env.BROADCAST_FANOUT,
  connections: {
    sse: { driver: "sse" },
    log: { driver: "log" },
    sync: { driver: "sync" },
    pusher: {
      driver: "pusher",
      key: process.env.PUSHER_APP_KEY,
      secret: process.env.PUSHER_APP_SECRET,
      app_id: process.env.PUSHER_APP_ID,
      options: {
        cluster: process.env.PUSHER_APP_CLUSTER,
        host: process.env.PUSHER_HOST,
      },
    },
    ably: {
      driver: "ably",
      key: process.env.ABLY_API_KEY,
      host: process.env.ABLY_REST_HOST,
    },
  },
};
```

`BroadcastServiceProvider` boots the chosen driver, an in-memory (or Redis) presence store, and the SSE hub. It also imports `routes/channels.ts` when that file exports `registerChannels`.

| Driver | Role |
| --- | --- |
| `sse` | Publish through the in-process `SseHub`. Browsers use `EventSource`. |
| `pusher` | HTTP POST to the Pusher Channels API (or a compatible host such as Soketi). |
| `ably` | HTTP POST to the Ably REST API. |
| `log` | Write the event to the console. Useful in development. |
| `sync` | Deliver to in-process listeners registered with `SyncBroadcaster.listen`. |
| `null` | Discard the event. |

`PRESENCE_DRIVER=redis` stores presence members in Redis. `BROADCAST_FANOUT=redis` (or Redis presence) also fans SSE publishes across processes through Redis pub/sub so every HTTP worker's hub sees the same events.

A minimal app that does not load the framework provider can call `setBroadcaster` itself:

```ts
import { SseHub, SseBroadcaster, setBroadcaster, setSseHub } from "@bunyad/broadcasting";

const hub = new SseHub();
setSseHub(hub);
setBroadcaster(new SseBroadcaster(hub));
```

## Defining broadcast events

Extend `ShouldBroadcast` and implement `broadcastOn`. Optional methods control the name, payload, whether to send, and which connection to use:

```ts
import { ShouldBroadcast } from "@bunyad/broadcasting";

export default class OrderShipped extends ShouldBroadcast {
  constructor(readonly orderId: number) {
    super();
  }

  broadcastOn(): string | string[] {
    return `orders.${this.orderId}`;
  }

  broadcastAs(): string {
    return "order.shipped";
  }

  broadcastWith(): Record<string, unknown> {
    return { orderId: this.orderId };
  }

  broadcastWhen(): boolean {
    return this.orderId > 0;
  }

  broadcastConnection(): string | null {
    return null;
  }
}
```

`broadcastAs` defaults to the class name. `broadcastWith` defaults to the instance's own enumerable fields. `broadcastWhen` returning `false` skips the send. `broadcastConnection` returning a string name uses that driver for this event; `null` uses the default.

`ShouldBroadcastNow` is the same type with a name that marks the event as immediate. Today both `Broadcast.event` and `Broadcast.queue` send at once.

## Broadcasting events

```ts
import { broadcast, Broadcast } from "@bunyad/broadcasting";
import OrderShipped from "@/Events/OrderShipped.ts";

await broadcast(new OrderShipped(42));
await Broadcast.event(new OrderShipped(42));
await Broadcast.event(new OrderShipped(42), "log");
```

The second argument to `event` (and `queue`) forces a connection name. It overrides `broadcastConnection` on the event.

### Anonymous events

You can broadcast without a class:

```ts
await Broadcast.on("orders")
  .as("OrderPlaced")
  .with({ id: 42 })
  .send();

await Broadcast.private("user.9")
  .as("Ping")
  .with({ n: 1 })
  .send();

await Broadcast.presence("chat")
  .as("MessageSent")
  .with({ text: "hello" })
  .send();
```

`private` prefixes channel names with `private-` when the prefix is missing. `presence` does the same with `presence-`. `via("log")` picks a connection. `toOthers()` copies the current socket id from `Broadcast.socket()` into the payload as `socket_id` when one is set, so a client that knows its socket can ignore its own echo:

```ts
Broadcast.socket(request.header("X-Socket-Id") ?? null);

await Broadcast.private("user.9")
  .as("Ping")
  .with({ n: 1 })
  .toOthers()
  .send();
```

`send` and `sendNow` are the same call.

### Drivers and extensions

```ts
Broadcast.driver();
Broadcast.driver("log");
Broadcast.connection("sse");
Broadcast.setDefaultDriver("log");
Broadcast.extend("custom", () => new SyncBroadcaster());
Broadcast.purge("log");
Broadcast.forgetDrivers();
```

Built-in names that need no prior registration are `null`, `log`, `sync`, and `sse`. Pusher and Ably instances are registered when the service provider boots those drivers, or when you call `Broadcast.setPusher` / `Broadcast.setAbly`.

## Authorizing channels

Register callbacks in `routes/channels.ts`. The framework provider calls `registerChannels` on boot:

```ts
import { Broadcast, type ChannelUser } from "@bunyad/broadcasting";

export function registerChannels(): void {
  Broadcast.channel("private-user.{id}", (user: ChannelUser | null, id: string) => {
    return user != null && String(user.id) === id;
  });

  Broadcast.channel("presence-chat", (user: ChannelUser | null) => {
    if (!user) return false;
    return {
      id: user.id,
      name: user.name ?? user.email ?? user.id,
    };
  });
}
```

Patterns use `{param}` segments. Public channel names (no `private-` or `presence-` prefix) authorize as `true` without a callback. Private and presence channels need a matching callback; a miss returns `false`.

`Broadcast.authorize(channelName, user)` and `Broadcast.auth` run that logic. Return `true` to allow a private channel. Return an object for presence so the client receives member info. Return `false` to deny.

`private-`, `presence-`, and `private-encrypted-` prefixes are stripped when matching, so a pattern of `user.{id}` also matches `private-user.1`.

### Auth HTTP routes

`Broadcast.routes()` returns the paths and middleware you should mount. It does not register them on the router for you:

```ts
import { Route } from "@bunyad/router";
import { Broadcast } from "@bunyad/broadcasting";
import BroadcastingController from "@/Http/Controllers/BroadcastingController.ts";

for (const def of Broadcast.routes({ middleware: ["web", "auth"] })) {
  Route.post(def.path, [BroadcastingController, "auth"]).middleware(def.middleware);
}
```

The defaults are `POST /broadcasting/auth` and `POST /broadcasting/user-auth`, with middleware `web` and `auth`. Pass `path`, `userPath`, and `middleware` to change them. Your handler should read `channel_name` from the body, resolve the current user, and return JSON from `Broadcast.authorize`.

## Receiving broadcasts (SSE)

With the `sse` driver, subscribe through the hub. A typical route accepts one or more `channel` query values, authorizes them, then returns the stream:

```ts
import type { Request } from "@bunyad/http";
import { json } from "@bunyad/http";
import { Auth } from "@bunyad/auth";
import { Broadcast, type ChannelUser } from "@bunyad/broadcasting";

export default class BroadcastingController {
  async sse(request: Request) {
    const url = new URL(request.url);
    const channels = url.searchParams.getAll("channel");
    if (channels.length === 0) {
      return json({ message: "channel query required" }, 422);
    }

    const user = (await Auth().user(request)) as ChannelUser | null;
    for (const channel of channels) {
      if (!(await Broadcast.authorize(channel, user))) {
        return json({ message: `Unauthorized channel [${channel}].` }, 403);
      }
    }

    return Broadcast.hub().subscribe(channels);
  }
}
```

In the browser, open an `EventSource` on that URL. Each publish arrives as an SSE event whose `data` is JSON with `channels` and `payload`:

```js
const source = new EventSource("/api/broadcasting/sse?channel=orders.1");

source.addEventListener("order.shipped", (event) => {
  const body = JSON.parse(event.data);
  console.log(body.payload.orderId);
});
```

Closing the `EventSource` cancels the stream. Pass `onCancel` to `subscribe` when you need to leave presence channels at that moment.

For `pusher` or `ably`, use that vendor's JavaScript client against your auth endpoint. The server still authorizes with `Broadcast.authorize`.

## Presence channels

Presence channels are named with a `presence-` prefix. Authorize them with a callback that returns member info. The presence store tracks who is joined:

```ts
const presence = Broadcast.presence();

await presence.join("presence-chat", user, { name: user.name });
await presence.members("presence-chat");
await presence.leave("presence-chat", user.id);
```

A common pattern joins on SSE connect, publishes `presence.here` and `presence.joining`, and leaves in `onCancel` with `presence.leaving`. `Broadcast.presence("chat")` with channel arguments is the anonymous presence broadcast helper, not the member store.

With `PRESENCE_DRIVER=redis`, members survive across workers. Pair that with hub fan-out so every process's SSE subscribers see joins and leaves.

## Sync and log drivers

`SyncBroadcaster` is for tests and in-process listeners:

```ts
import { SyncBroadcaster, setBroadcaster, broadcast } from "@bunyad/broadcasting";

const driver = new SyncBroadcaster();
setBroadcaster(driver);

driver.listen("orders.9", (event, payload) => {
  console.log(event, payload);
});

await broadcast(new OrderShipped(9));
```

`LogBroadcaster` prints the channel list, event name, and payload. `NullBroadcaster` drops the message.
