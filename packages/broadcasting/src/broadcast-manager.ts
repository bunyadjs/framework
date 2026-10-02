import type { Broadcaster } from "./broadcaster.ts";
import type { ShouldBroadcast } from "./should-broadcast.ts";
import { ShouldBroadcastNow } from "./should-broadcast.ts";
import { AnonymousBroadcast } from "./anonymous-broadcast.ts";
import { NullBroadcaster } from "./null-broadcaster.ts";
import { LogBroadcaster } from "./log-broadcaster.ts";
import { SyncBroadcaster } from "./sync-broadcaster.ts";
import type { PusherBroadcaster } from "./pusher-broadcaster.ts";
import type { AblyBroadcaster } from "./ably-broadcaster.ts";
import { SseBroadcaster } from "./sse-broadcaster.ts";
import { getSseHub } from "./sse-helpers.ts";
import { getChannelManager, type ChannelUser } from "./channels.ts";

export type BroadcasterFactory = (
  config?: Record<string, unknown>,
) => Broadcaster;

export type BroadcastRoutesOptions = {
  /** Path for channel auth (default `/broadcasting/auth`). */
  path?: string;
  /** Path for user auth (default `/broadcasting/user-auth`). */
  userPath?: string;
  middleware?: string[];
  /** Skip binding handlers on the active router. */
  definitionsOnly?: boolean;
};

export type BroadcastRouteDefinition = {
  method: "POST";
  path: string;
  middleware: string[];
  /** Kind of built-in broadcasting route. */
  name: "broadcasting.auth" | "broadcasting.user-auth";
};

/** Minimal queue surface for deferred broadcasts. */
export type BroadcastQueue = {
  push(name: string, data: unknown, queue?: string): Promise<string>;
  register(name: string, handler: (data: unknown) => void | Promise<void>): unknown;
};

export const SEND_QUEUED_BROADCAST = "SendQueuedBroadcast";

type QueuedBroadcastPayload = {
  event: ShouldBroadcast;
  connection?: string | null;
};

/**
 * `BroadcastManager` — named drivers + anonymous broadcasts.
 */
export class BroadcastManager {
  readonly #drivers = new Map<string, Broadcaster>();
  readonly #custom = new Map<string, BroadcasterFactory>();
  #defaultDriver = "null";
  #socketId: string | null = null;
  #pusher: PusherBroadcaster | null = null;
  #ably: AblyBroadcaster | null = null;
  #queue: BroadcastQueue | null = null;
  #routesRegistered = false;

  setDefaultDriver(name: string): this {
    this.#defaultDriver = name;
    return this;
  }

  getDefaultDriver(): string {
    return this.#defaultDriver;
  }

  /**
   * Register (or replace) a resolved driver instance.
   */
  setDriver(name: string, driver: Broadcaster): this {
    this.#drivers.set(name, driver);
    return this;
  }

  extend(driver: string, callback: BroadcasterFactory): this {
    this.#custom.set(driver, callback);
    return this;
  }

  driver(name?: string | null): Broadcaster {
    return this.get(name);
  }

  /** Alias of {@link driver}. */
  connection(name?: string | null): Broadcaster {
    return this.driver(name);
  }

  get(name?: string | null): Broadcaster {
    const driverName = name ?? this.#defaultDriver;
    const existing = this.#drivers.get(driverName);
    if (existing) return existing;

    const custom = this.#custom.get(driverName);
    if (custom) {
      const created = custom();
      this.#drivers.set(driverName, created);
      return created;
    }

    const created = this.#createDriver(driverName);
    this.#drivers.set(driverName, created);
    return created;
  }

  #createDriver(name: string): Broadcaster {
    switch (name) {
      case "null":
        return new NullBroadcaster();
      case "log":
        return new LogBroadcaster();
      case "sync":
        return new SyncBroadcaster();
      case "sse":
        return new SseBroadcaster(getSseHub());
      default:
        throw new Error(`Broadcast driver [${name}] is not supported.`);
    }
  }

  forgetDrivers(): this {
    this.#drivers.clear();
    return this;
  }

  purge(name?: string | null): this {
    if (name == null) {
      this.#drivers.clear();
      return this;
    }
    this.#drivers.delete(name);
    return this;
  }

  socket(socketId?: string | null): string | null {
    if (socketId !== undefined) {
      this.#socketId = socketId;
    }
    return this.#socketId;
  }

  /**
   * Bind a queue so `Broadcast.queue` defers delivery for workers.
   */
  setQueue(queue: BroadcastQueue | null): this {
    this.#queue = queue;
    if (queue) {
      queue.register(SEND_QUEUED_BROADCAST, async (data) => {
        const payload = data as QueuedBroadcastPayload;
        await this.event(payload.event, payload.connection);
      });
    }
    return this;
  }

  /**
   * Broadcast a `ShouldBroadcast` event on the default (or given) connection.
   */
  async event(
    event: ShouldBroadcast,
    connection?: string | null,
  ): Promise<void> {
    if (!event.broadcastWhen()) return;
    const channels = event.broadcastOn();
    const list = Array.isArray(channels) ? channels : [channels];
    const payload = { ...event.broadcastWith() };
    const socket = this.#socketId;
    if (socket) payload.socket_id = socket;
    const conn =
      connection !== undefined && connection !== null
        ? connection
        : event.broadcastConnection();
    await this.driver(conn).broadcast(
      list,
      event.broadcastAs(),
      payload,
    );
  }

  /**
   * Queue a broadcast. Without a queue binding (or for `ShouldBroadcastNow`)
   * this sends immediately.
   */
  async queue(
    event: ShouldBroadcast,
    connection?: string | null,
  ): Promise<void> {
    if (event instanceof ShouldBroadcastNow || !this.#queue) {
      return this.event(event, connection);
    }
    const queueName = event.broadcastQueue() ?? undefined;
    await this.#queue.push(
      SEND_QUEUED_BROADCAST,
      { event, connection } satisfies QueuedBroadcastPayload,
      queueName,
    );
  }

  on(channels: string | string[]): AnonymousBroadcast {
    return AnonymousBroadcast.on(channels);
  }

  privateChannel(channels: string | string[]): AnonymousBroadcast {
    return AnonymousBroadcast.private(channels);
  }

  /**
   * Anonymous presence-channel broadcast when channels are passed.
   * (Presence member store remains on the `Broadcast` facade overload.)
   */
  presenceChannel(channels: string | string[]): AnonymousBroadcast {
    return AnonymousBroadcast.presence(channels);
  }

  /**
   * Register broadcasting HTTP routes on the active router (and return defs).
   */
  routes(options: BroadcastRoutesOptions = {}): BroadcastRouteDefinition[] {
    const defs = [
      ...this.channelRoutes(options),
      ...this.userRoutes(options),
    ];
    if (!options.definitionsOnly) {
      void this.#bindRoutes(defs);
    }
    return defs;
  }

  channelRoutes(
    options: BroadcastRoutesOptions = {},
  ): BroadcastRouteDefinition[] {
    return [
      {
        method: "POST",
        path: options.path ?? "/broadcasting/auth",
        middleware: options.middleware ?? ["web", "auth"],
        name: "broadcasting.auth",
      },
    ];
  }

  userRoutes(
    options: BroadcastRoutesOptions = {},
  ): BroadcastRouteDefinition[] {
    return [
      {
        method: "POST",
        path: options.userPath ?? "/broadcasting/user-auth",
        middleware: options.middleware ?? ["web", "auth"],
        name: "broadcasting.user-auth",
      },
    ];
  }

  async #bindRoutes(defs: BroadcastRouteDefinition[]): Promise<void> {
    if (this.#routesRegistered) return;
    try {
      const { getActiveRouter } = await import("@bunyad/router");
      const { json } = await import("@bunyad/http");
      const router = getActiveRouter();
      for (const def of defs) {
        const handler =
          def.name === "broadcasting.auth"
            ? authChannelHandler(json)
            : authUserHandler(json);
        const registrar = router.post(def.path, handler).name(def.name);
        if (def.middleware.length) {
          registrar.middleware(...def.middleware);
        }
      }
      this.#routesRegistered = true;
    } catch {
      // Router may be unavailable in isolated package tests.
    }
  }

  /** Underlying Pusher broadcaster when registered via {@link setPusher}. */
  pusher(): PusherBroadcaster | null {
    return this.#pusher;
  }

  setPusher(driver: PusherBroadcaster | null): this {
    this.#pusher = driver;
    if (driver) this.setDriver("pusher", driver);
    return this;
  }

  /** Underlying Ably broadcaster when registered via {@link setAbly}. */
  ably(): AblyBroadcaster | null {
    return this.#ably;
  }

  setAbly(driver: AblyBroadcaster | null): this {
    this.#ably = driver;
    if (driver) this.setDriver("ably", driver);
    return this;
  }
}

function authChannelHandler(json: (data: unknown, status?: number) => Response) {
  return async (request: {
    loadJson?: () => Promise<void>;
    input: (key: string) => unknown;
    user?: ChannelUser | null;
  }) => {
    await request.loadJson?.();
    const channelName = String(request.input("channel_name") ?? "");
    if (!channelName) {
      return json({ message: "channel_name required" }, 422);
    }
    const user = (request.user as ChannelUser | null | undefined) ?? null;
    const result = await getChannelManager().authorize(channelName, user);
    if (!result) {
      return json({ message: "Forbidden" }, 403);
    }
    if (channelName.startsWith("presence-") && result !== true) {
      return json({
        auth: true,
        channel_name: channelName,
        socket_id: request.input("socket_id") ?? null,
        channel_data: {
          user_id: String(user?.id ?? ""),
          user_info: result,
        },
      });
    }
    return json({
      auth: true,
      channel_name: channelName,
      socket_id: request.input("socket_id") ?? null,
      ...(result !== true ? { channel_data: result } : {}),
    });
  };
}

function authUserHandler(json: (data: unknown, status?: number) => Response) {
  return async (request: {
    loadJson?: () => Promise<void>;
    user?: ChannelUser | null;
  }) => {
    await request.loadJson?.();
    const user = (request.user as ChannelUser | null | undefined) ?? null;
    if (!user) {
      return json({ message: "Unauthenticated." }, 401);
    }
    return json({
      id: user.id,
      name:
        (user.name as string | undefined) ??
        (user.email as string | undefined) ??
        user.id,
    });
  };
}

let defaultManager: BroadcastManager | undefined;

export function setBroadcastManager(manager: BroadcastManager): void {
  defaultManager = manager;
}

export function getBroadcastManager(): BroadcastManager {
  return defaultManager ?? (defaultManager = new BroadcastManager());
}
