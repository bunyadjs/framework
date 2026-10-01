import { ServiceProvider, isBunEmbeddedPath } from "@bunyad/core";
import { existsSync } from "node:fs";
import {
  SyncBroadcaster,
  LogBroadcaster,
  SseHub,
  SseBroadcaster,
  PusherBroadcaster,
  AblyBroadcaster,
  ChannelManager,
  PresenceStore,
  RedisPresenceStore,
  RedisHubFanout,
  setBroadcaster,
  setSseHub,
  setChannelManager,
  setPresenceStore,
  setHubFanout,
  takePreloadedChannels,
  getBroadcastManager,
  ShouldBroadcast,
  ShouldBroadcastNow,
} from "@bunyad/broadcasting";
import { setShouldBroadcastHandler } from "@bunyad/events";
import type { QueueManager } from "@bunyad/queue";
import { resolveRedisUrl } from "./database-config.ts";

export type BroadcastConnectionConfig = {
  driver?: string;
  key?: string;
  secret?: string;
  app_id?: string;
  host?: string;
  options?: {
    cluster?: string;
    host?: string;
  };
};

export type BroadcastingConfig = {
  default?: string;
  presence?: string;
  fanout?: string;
  connections?: Record<string, BroadcastConnectionConfig>;
};

export class BroadcastServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    const config = this.app.config.get<BroadcastingConfig>("broadcasting") ?? {};
    setChannelManager(new ChannelManager());

    const redisUrl = resolveRedisUrl(this.app);
    setPresenceStore(
      (config.presence ?? process.env.PRESENCE_DRIVER) === "redis"
        ? new RedisPresenceStore({ url: redisUrl })
        : new PresenceStore(),
    );

    const sseHub = new SseHub();
    setSseHub(sseHub);

    const useHubFanout =
      (config.presence ?? process.env.PRESENCE_DRIVER) === "redis" ||
      (config.fanout ?? process.env.BROADCAST_FANOUT) === "redis";

    if (useHubFanout) {
      const fanout = new RedisHubFanout({
        hub: sseHub,
        url: redisUrl,
      });
      setHubFanout(fanout);
      await fanout.start();
    } else {
      setHubFanout(undefined);
    }

    const name = config.default ?? process.env.BROADCAST_DRIVER ?? "sse";
    const connection = config.connections?.[name] ?? {};
    const broadcastDriver = connection.driver ?? name;

    if (broadcastDriver === "log") {
      setBroadcaster(new LogBroadcaster());
    } else if (broadcastDriver === "sync") {
      setBroadcaster(new SyncBroadcaster());
    } else if (broadcastDriver === "pusher") {
      setBroadcaster(
        new PusherBroadcaster({
          appId: connection.app_id ?? process.env.PUSHER_APP_ID ?? "",
          key: connection.key ?? process.env.PUSHER_APP_KEY ?? "",
          secret: connection.secret ?? process.env.PUSHER_APP_SECRET ?? "",
          cluster:
            connection.options?.cluster ?? process.env.PUSHER_APP_CLUSTER,
          host: connection.options?.host ?? process.env.PUSHER_HOST,
        }),
      );
    } else if (broadcastDriver === "ably") {
      setBroadcaster(
        new AblyBroadcaster({
          apiKey: connection.key ?? process.env.ABLY_API_KEY ?? "",
          host: connection.host ?? process.env.ABLY_REST_HOST,
        }),
      );
    } else {
      setBroadcaster(new SseBroadcaster(sseHub));
    }

    const manager = getBroadcastManager();
    try {
      const queue = this.app.make<QueueManager>("queue");
      manager.setQueue(queue);
    } catch {
      // Queue may be unavailable in minimal apps.
    }

    setShouldBroadcastHandler(async (event) => {
      if (!(event instanceof ShouldBroadcast)) return;
      if (event instanceof ShouldBroadcastNow) {
        await manager.event(event);
        return;
      }
      await manager.queue(event);
    });

    const preloaded = takePreloadedChannels();
    if (preloaded) {
      await preloaded();
      return;
    }
    await loadChannelRoutes(this.app.basePath("routes/channels.ts"));
  }
}

async function loadChannelRoutes(file: string): Promise<void> {
  // Compiled binaries must use the preloaded registrar — a disk import of
  // `routes/channels.ts` cannot resolve workspace packages from `/$bunfs`.
  if (isBunEmbeddedPath(import.meta.dir)) return;
  if (!existsSync(file)) return;
  const mod = await import(file);
  if (typeof mod.registerChannels === "function") {
    await mod.registerChannels();
  }
}
