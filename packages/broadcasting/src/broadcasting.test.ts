import { expect, test } from "bun:test";
import {
  ShouldBroadcast,
  SyncBroadcaster,
  broadcast,
  setBroadcaster,
  ChannelManager,
  Broadcast,
  setChannelManager,
  matchPattern,
} from "../src/index.ts";

class OrderShipped extends ShouldBroadcast {
  constructor(readonly orderId: number) {
    super();
  }

  broadcastOn() {
    return `orders.${this.orderId}`;
  }

  broadcastAs() {
    return "order.shipped";
  }
}

test("sync broadcaster delivers to listeners", async () => {
  const driver = new SyncBroadcaster();
  setBroadcaster(driver);

  const seen: string[] = [];
  driver.listen("orders.9", (event, payload) => {
    seen.push(`${event}:${payload.orderId}`);
  });

  await broadcast(new OrderShipped(9));
  expect(seen).toEqual(["order.shipped:9"]);
  expect(driver.sent).toHaveLength(1);
});

test("SSE hub publishes to subscribers", async () => {
  const { SseHub, SseBroadcaster, setBroadcaster: setBc, broadcast: bc } =
    await import("../src/index.ts");

  const hub = new SseHub();
  setBc(new SseBroadcaster(hub));
  const res = hub.subscribe(["orders.1"]);
  expect(res.headers.get("Content-Type")).toContain("text/event-stream");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  const first = await reader.read();
  expect(decoder.decode(first.value)).toContain("connected");

  await bc(new OrderShipped(1));
  const second = await reader.read();
  const text = decoder.decode(second.value);
  expect(text).toContain("event: order.shipped");
  expect(text).toContain('"orderId":1');
  await reader.cancel();
});

test("Pusher auth signature is stable", async () => {
  const { signPusherRequest } = await import("../src/pusher-broadcaster.ts");
  const qs = await signPusherRequest({
    method: "POST",
    path: "/apps/1/events",
    body: '{"name":"x"}',
    key: "key",
    secret: "secret",
    timestamp: 1700000000,
  });
  expect(qs).toContain("auth_key=key");
  expect(qs).toContain("auth_signature=");
  expect(qs).toContain("body_md5=");
});

test("channel pattern matching and authorize", async () => {
  expect(matchPattern("private-user.{id}", "private-user.7")).toEqual(["7"]);
  expect(matchPattern("private-user.{id}", "private-user")).toBeNull();

  const channels = new ChannelManager();
  channels.channel("private-user.{id}", (user, id) => {
    return user != null && String(user.id) === id;
  });

  expect(await channels.authorize("users", null)).toBe(true);
  expect(await channels.authorize("private-user.1", null)).toBe(false);
  expect(await channels.authorize("private-user.1", { id: 1 })).toBe(true);
  expect(await channels.authorize("private-user.2", { id: 1 })).toBe(false);
});

test("preloaded channel routes are consumed once", async () => {
  const { setPreloadedChannels, takePreloadedChannels } = await import(
    "../src/index.ts"
  );
  let ran = 0;
  setPreloadedChannels(() => {
    ran += 1;
  });
  const first = takePreloadedChannels();
  expect(first).toBeDefined();
  await first?.();
  expect(ran).toBe(1);
  expect(takePreloadedChannels()).toBeUndefined();
});

test("Broadcast facade registers authorizes presence and hub", async () => {
  setChannelManager(new ChannelManager());
  Broadcast.channel("private-post.{id}", (user, id) => {
    return user != null && String(user.id) === id;
  });
  expect(await Broadcast.authorize("private-post.3", { id: 3 })).toBe(true);
  expect(await Broadcast.authorize("private-post.3", { id: 1 })).toBe(false);
  expect(Broadcast.presence()).toBeDefined();
  expect(Broadcast.hub()).toBeDefined();
});

test("AblyBroadcaster posts messages", async () => {
  const { AblyBroadcaster } = await import("../src/ably-broadcaster.ts");
  const calls: Array<{ url: string; body: string }> = [];
  const driver = new AblyBroadcaster({
    apiKey: "key:secret",
    fetch: (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("{}", { status: 201 });
    }) as typeof fetch,
  });
  await driver.broadcast(["chat"], "message", { text: "hi" });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain("/channels/chat/messages");
  expect(calls[0]!.body).toContain("message");
});

test("presence store join leave members", async () => {
  const { PresenceStore } = await import("../src/presence.ts");
  const store = new PresenceStore();
  store.join("presence-chat", { id: 1, name: "Ada" }, { name: "Ada" });
  store.join("presence-chat", { id: 2, name: "Bob" }, { name: "Bob" });
  expect(store.members("presence-chat")).toHaveLength(2);
  store.leave("presence-chat", 1);
  expect(store.members("presence-chat").map((m) => m.id)).toEqual(["2"]);
});

test("RedisPresenceStore with mock client", async () => {
  const hash = new Map<string, Map<string, string>>();
  const client = {
    async hset(key: string, field: string, value: string) {
      const map = hash.get(key) ?? new Map();
      map.set(field, value);
      hash.set(key, map);
      return 1;
    },
    async hdel(key: string, field: string) {
      return hash.get(key)?.delete(field) ? 1 : 0;
    },
    async hgetall(key: string) {
      const map = hash.get(key);
      if (!map) return {};
      return Object.fromEntries(map);
    },
  };
  const { RedisPresenceStore } = await import("../src/redis-presence.ts");
  const store = new RedisPresenceStore({ client: client as never });
  await store.join("presence-chat", { id: 1 }, { name: "Ada" });
  expect(await store.members("presence-chat")).toHaveLength(1);
  await store.leave("presence-chat", 1);
  expect(await store.members("presence-chat")).toHaveLength(0);
});

test("RedisPresenceFanout relays remote events and skips origin", async () => {
  const { SseHub } = await import("../src/sse-hub.ts");
  const { RedisPresenceFanout } = await import("../src/presence-fanout.ts");

  const published: Array<{ channel: string; message: string }> = [];
  let handler: ((message: string, channel: string) => void) | undefined;

  const pub = {
    async connect() {},
    async duplicate() {
      return {
        async subscribe(
          _channel: string,
          cb: (message: string, channel: string) => void,
        ) {
          handler = cb;
        },
      };
    },
    async publish(channel: string, message: string) {
      published.push({ channel, message });
      return 1;
    },
  };

  const hub = new SseHub();
  const events: string[] = [];
  const original = hub.publish.bind(hub);
  hub.publish = (channels, event, payload) => {
    events.push(event);
    original(channels, event, payload);
  };

  const fanout = new RedisPresenceFanout({
    hub,
    client: pub as never,
    origin: "worker-a",
  });
  await fanout.start();

  await fanout.publish(["presence-chat"], "presence.joining", {
    id: "1",
  });
  expect(published).toHaveLength(1);
  expect(JSON.parse(published[0]!.message).origin).toBe("worker-a");

  handler!(published[0]!.message, "bunyad:hub:events");
  expect(events).toHaveLength(0);

  handler!(
    JSON.stringify({
      origin: "worker-b",
      channels: ["presence-chat"],
      event: "presence.leaving",
      payload: { id: "2" },
    }),
    "bunyad:hub:events",
  );
  expect(events).toEqual(["presence.leaving"]);
});

test("SseBroadcaster fans out over Redis when hub fanout is set", async () => {
  const { SseHub } = await import("../src/sse-hub.ts");
  const { SseBroadcaster } = await import("../src/sse-broadcaster.ts");
  const {
    RedisHubFanout,
    setHubFanout,
  } = await import("../src/presence-fanout.ts");

  const published: string[] = [];
  const pub = {
    async connect() {},
    async duplicate() {
      return {
        async subscribe() {},
      };
    },
    async publish(_channel: string, message: string) {
      published.push(message);
      return 1;
    },
  };

  const hub = new SseHub();
  const fanout = new RedisHubFanout({
    hub,
    client: pub as never,
    origin: "worker-a",
  });
  setHubFanout(fanout);

  const driver = new SseBroadcaster(hub);
  await driver.broadcast(["users"], "UserCreated", { id: 1 });
  expect(published).toHaveLength(1);
  expect(JSON.parse(published[0]!).event).toBe("UserCreated");

  setHubFanout(undefined);
});

test("Broadcast manager driver extend event on private socket routes", async () => {
  const {
    Broadcast,
    SyncBroadcaster,
    NullBroadcaster,
    setBroadcastManager,
    BroadcastManager,
    ShouldBroadcast,
  } = await import("../src/index.ts");

  setBroadcastManager(new BroadcastManager());
  const sync = new SyncBroadcaster();
  Broadcast.extend("custom", () => sync);
  Broadcast.setDefaultDriver("custom");

  expect(Broadcast.getDefaultDriver()).toBe("custom");
  expect(Broadcast.driver()).toBe(sync);
  expect(Broadcast.connection("null")).toBeInstanceOf(NullBroadcaster);

  const seen: string[] = [];
  sync.listen("orders", (event, payload) => {
    seen.push(`${event}:${payload.id}`);
  });

  await Broadcast.on("orders").as("OrderPlaced").with({ id: 42 }).send();
  expect(seen).toEqual(["OrderPlaced:42"]);

  seen.length = 0;
  sync.listen("private-user.9", (event) => {
    seen.push(event);
  });
  Broadcast.socket("sock-1");
  await Broadcast.private("user.9").as("Ping").with({ n: 1 }).toOthers().send();
  expect(seen).toEqual(["Ping"]);
  expect(sync.sent.at(-1)?.payload.socket_id).toBe("sock-1");

  class Ping extends ShouldBroadcast {
    broadcastOn() {
      return "orders";
    }
    broadcastAs() {
      return "ping";
    }
    broadcastWith() {
      return { ok: true };
    }
  }
  await Broadcast.event(new Ping());
  await Broadcast.queue(new Ping());

  const routes = Broadcast.routes({
    middleware: ["auth"],
    definitionsOnly: true,
  });
  expect(routes.map((r) => r.name)).toEqual([
    "broadcasting.auth",
    "broadcasting.user-auth",
  ]);
  expect(Broadcast.channelRoutes()[0]!.path).toBe("/broadcasting/auth");
  expect(Broadcast.userRoutes()[0]!.path).toBe("/broadcasting/user-auth");

  Broadcast.forgetDrivers();
  Broadcast.purge();
  expect(await Broadcast.auth("orders", null)).toBe(true);
});


test("channel patterns omit private/presence prefix", async () => {
  const { ChannelManager, normalizeChannelName, setChannelManager, Broadcast } =
    await import("../src/index.ts");

  expect(normalizeChannelName("private-user.7")).toBe("user.7");
  expect(normalizeChannelName("presence-chat")).toBe("chat");
  expect(normalizeChannelName("private-encrypted-orders.1")).toBe("orders.1");

  const channels = new ChannelManager();
  channels.channel("orders.{id}", (user, id) => {
    return user != null && String(user.id) === id;
  });
  channels.channel("chat", (user) => {
    if (!user) return false;
    return { id: user.id, name: "Ada" };
  });

  // Prefixed client names match unprefixed registrations
  expect(await channels.authorize("private-orders.9", { id: 9 })).toBe(true);
  expect(await channels.authorize("private-orders.9", { id: 1 })).toBe(false);
  expect(await channels.authorize("presence-chat", { id: 1 })).toEqual({
    id: 1,
    name: "Ada",
  });

  // Prefixed Bunyad registrations still work
  setChannelManager(new ChannelManager());
  Broadcast.channel("private-user.{id}", (user, id) => {
    return user != null && String(user.id) === id;
  });
  expect(await Broadcast.authorize("private-user.3", { id: 3 })).toBe(true);
});

test("PusherBroadcaster posts with useTLS false for Soketi-style hosts", async () => {
  const { PusherBroadcaster } = await import("../src/pusher-broadcaster.ts");
  const calls: Array<{ url: string; body: string }> = [];
  const driver = new PusherBroadcaster({
    appId: "1",
    key: "key",
    secret: "secret",
    host: "localhost:6001",
    useTLS: false,
    fetch: (async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  await driver.broadcast(["orders"], "OrderShipped", { id: 1 });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url.startsWith("http://localhost:6001/apps/1/events")).toBe(
    true,
  );
  expect(calls[0]!.body).toContain("OrderShipped");
});

test("Broadcast.driver sse + broadcastWhen / broadcastConnection", async () => {
  const {
    Broadcast,
    BroadcastManager,
    setBroadcastManager,
    setSseHub,
    SseHub,
    SseBroadcaster,
    SyncBroadcaster,
    ShouldBroadcast,
    ShouldBroadcastNow,
  } = await import("../src/index.ts");

  setBroadcastManager(new BroadcastManager());
  const hub = new SseHub();
  setSseHub(hub);
  expect(Broadcast.driver("sse")).toBeInstanceOf(SseBroadcaster);

  const sync = new SyncBroadcaster();
  Broadcast.extend("orders-conn", () => sync);
  Broadcast.setDefaultDriver("orders-conn");

  class Conditional extends ShouldBroadcast {
    constructor(
      readonly id: number,
      readonly allow: boolean,
    ) {
      super();
    }
    broadcastOn() {
      return "orders";
    }
    broadcastAs() {
      return "maybe";
    }
    broadcastWhen() {
      return this.allow;
    }
  }

  await Broadcast.event(new Conditional(1, false));
  expect(sync.sent).toHaveLength(0);
  await Broadcast.event(new Conditional(2, true));
  expect(sync.sent).toHaveLength(1);

  const other = new SyncBroadcaster();
  Broadcast.extend("other", () => other);

  class Routed extends ShouldBroadcastNow {
    broadcastOn() {
      return "orders";
    }
    broadcastAs() {
      return "routed";
    }
    broadcastConnection() {
      return "other";
    }
  }
  await Broadcast.event(new Routed());
  expect(other.sent).toHaveLength(1);
  expect(other.sent[0]!.event).toBe("routed");
});

test("Broadcast.queue defers when queue bound", async () => {
  const { QueueManager } = await import("@bunyad/queue");
  const {
    Broadcast,
    SyncBroadcaster,
    ShouldBroadcast,
    setBroadcastManager,
    BroadcastManager,
    setBroadcaster,
  } = await import("../src/index.ts");

  const manager = new BroadcastManager();
  setBroadcastManager(manager);
  const sync = new SyncBroadcaster();
  setBroadcaster(sync);
  manager.setDriver("null", sync);
  manager.setDefaultDriver("null");

  const queue = new QueueManager({ connection: "memory" });
  manager.setQueue(queue);

  class Later extends ShouldBroadcast {
    broadcastOn() {
      return "orders";
    }
    broadcastAs() {
      return "later";
    }
  }

  await Broadcast.queue(new Later());
  expect(sync.sent).toHaveLength(0);
  await queue.work();
  expect(sync.sent).toHaveLength(1);
  expect(sync.sent[0]!.event).toBe("later");
});

test("event() ShouldBroadcast via dispatcher hook", async () => {
  const {
    Dispatcher,
    setEventDispatcher,
    setShouldBroadcastHandler,
    event,
  } = await import("@bunyad/events");
  const {
    SyncBroadcaster,
    ShouldBroadcast,
    getBroadcastManager,
    setBroadcastManager,
    BroadcastManager,
    setBroadcaster,
  } = await import("../src/index.ts");

  const manager = new BroadcastManager();
  setBroadcastManager(manager);
  const sync = new SyncBroadcaster();
  setBroadcaster(sync);
  manager.setDriver("null", sync);
  manager.setDefaultDriver("null");

  setEventDispatcher(new Dispatcher());
  setShouldBroadcastHandler(async (ev) => {
    if (ev instanceof ShouldBroadcast) {
      await manager.event(ev);
    }
  });

  class Shipped extends ShouldBroadcast {
    broadcastOn() {
      return "orders";
    }
    broadcastAs() {
      return "shipped";
    }
  }

  await event(new Shipped());
  expect(sync.sent).toHaveLength(1);
  expect(sync.sent[0]!.event).toBe("shipped");
  setShouldBroadcastHandler(undefined);
});
