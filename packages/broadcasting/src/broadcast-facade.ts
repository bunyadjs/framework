import type { SseHub } from "./sse-hub.ts";
import {
  getChannelManager,
  type ChannelAuthResult,
  type ChannelCallback,
  type ChannelManager,
  type ChannelUser,
} from "./channels.ts";
import { getPresenceStore, type PresenceRepository } from "./presence.ts";
import { getSseHub } from "./sse-helpers.ts";
import {
  getBroadcastManager,
  type BroadcastQueue,
  type BroadcastRouteDefinition,
  type BroadcastRoutesOptions,
  type BroadcasterFactory,
} from "./broadcast-manager.ts";
import type { Broadcaster } from "./broadcaster.ts";
import type { ShouldBroadcast } from "./should-broadcast.ts";
import type { AnonymousBroadcast } from "./anonymous-broadcast.ts";
import type { PusherBroadcaster } from "./pusher-broadcaster.ts";
import type { AblyBroadcaster } from "./ably-broadcaster.ts";

type BroadcastFacade = {
  channel(pattern: string, callback: ChannelCallback): ChannelManager;
  authorize(
    channelName: string,
    user: ChannelUser | null,
  ): Promise<ChannelAuthResult>;
  auth(
    channelName: string,
    user: ChannelUser | null,
  ): Promise<ChannelAuthResult>;
  presence(channels?: string | string[]): PresenceRepository | AnonymousBroadcast;
  hub(): SseHub;
  driver(name?: string | null): Broadcaster;
  connection(name?: string | null): Broadcaster;
  get(name?: string | null): Broadcaster;
  extend(driver: string, callback: BroadcasterFactory): BroadcastFacade;
  setDefaultDriver(name: string): BroadcastFacade;
  getDefaultDriver(): string;
  forgetDrivers(): BroadcastFacade;
  purge(name?: string | null): BroadcastFacade;
  socket(socketId?: string | null): string | null;
  event(
    event: ShouldBroadcast,
    connection?: string | null,
  ): Promise<void>;
  queue(
    event: ShouldBroadcast,
    connection?: string | null,
  ): Promise<void>;
  on(channels: string | string[]): AnonymousBroadcast;
  private(channels: string | string[]): AnonymousBroadcast;
  routes(options?: BroadcastRoutesOptions): BroadcastRouteDefinition[];
  channelRoutes(
    options?: BroadcastRoutesOptions,
  ): BroadcastRouteDefinition[];
  userRoutes(options?: BroadcastRoutesOptions): BroadcastRouteDefinition[];
  setQueue(queue: BroadcastQueue | null): BroadcastFacade;
  pusher(): PusherBroadcaster | null;
  ably(): AblyBroadcaster | null;
  setPusher(driver: PusherBroadcaster | null): BroadcastFacade;
  setAbly(driver: AblyBroadcaster | null): BroadcastFacade;
};

/** `Broadcast` facade. */
export const Broadcast: BroadcastFacade = {
  channel(pattern: string, callback: ChannelCallback): ChannelManager {
    return getChannelManager().channel(pattern, callback);
  },
  authorize(
    channelName: string,
    user: ChannelUser | null,
  ): Promise<ChannelAuthResult> {
    return getChannelManager().authorize(channelName, user);
  },
  /** Channel auth alias used by Pusher/Ably-style clients. */
  auth(
    channelName: string,
    user: ChannelUser | null,
  ): Promise<ChannelAuthResult> {
    return getChannelManager().authorize(channelName, user);
  },
  /**
   * Presence member store (no args), or anonymous presence-channel broadcast
   * when channel name(s) are passed — `Broadcast::presence($channels)`.
   */
  presence(channels?: string | string[]): PresenceRepository | AnonymousBroadcast {
    if (channels === undefined) return getPresenceStore();
    return getBroadcastManager().presenceChannel(channels);
  },
  hub(): SseHub {
    return getSseHub();
  },

  driver(name?: string | null): Broadcaster {
    return getBroadcastManager().driver(name);
  },
  connection(name?: string | null): Broadcaster {
    return getBroadcastManager().connection(name);
  },
  get(name?: string | null): Broadcaster {
    return getBroadcastManager().get(name);
  },
  extend(driver: string, callback: BroadcasterFactory): BroadcastFacade {
    getBroadcastManager().extend(driver, callback);
    return Broadcast;
  },
  setDefaultDriver(name: string): BroadcastFacade {
    getBroadcastManager().setDefaultDriver(name);
    return Broadcast;
  },
  getDefaultDriver(): string {
    return getBroadcastManager().getDefaultDriver();
  },
  forgetDrivers(): BroadcastFacade {
    getBroadcastManager().forgetDrivers();
    return Broadcast;
  },
  purge(name?: string | null): BroadcastFacade {
    getBroadcastManager().purge(name);
    return Broadcast;
  },
  socket(socketId?: string | null): string | null {
    return getBroadcastManager().socket(socketId);
  },
  event(
    event: ShouldBroadcast,
    connection?: string | null,
  ): Promise<void> {
    return getBroadcastManager().event(event, connection);
  },
  queue(
    event: ShouldBroadcast,
    connection?: string | null,
  ): Promise<void> {
    return getBroadcastManager().queue(event, connection);
  },
  on(channels: string | string[]): AnonymousBroadcast {
    return getBroadcastManager().on(channels);
  },
  /** `Broadcast::private()`. */
  private(channels: string | string[]): AnonymousBroadcast {
    return getBroadcastManager().privateChannel(channels);
  },
  routes(options?: BroadcastRoutesOptions): BroadcastRouteDefinition[] {
    return getBroadcastManager().routes(options);
  },
  channelRoutes(
    options?: BroadcastRoutesOptions,
  ): BroadcastRouteDefinition[] {
    return getBroadcastManager().channelRoutes(options);
  },
  userRoutes(options?: BroadcastRoutesOptions): BroadcastRouteDefinition[] {
    return getBroadcastManager().userRoutes(options);
  },
  setQueue(queue: BroadcastQueue | null): BroadcastFacade {
    getBroadcastManager().setQueue(queue);
    return Broadcast;
  },
  pusher(): PusherBroadcaster | null {
    return getBroadcastManager().pusher();
  },
  ably(): AblyBroadcaster | null {
    return getBroadcastManager().ably();
  },
  setPusher(driver: PusherBroadcaster | null): BroadcastFacade {
    getBroadcastManager().setPusher(driver);
    return Broadcast;
  },
  setAbly(driver: AblyBroadcaster | null): BroadcastFacade {
    getBroadcastManager().setAbly(driver);
    return Broadcast;
  },
};
