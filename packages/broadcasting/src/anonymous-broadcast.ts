import type { Broadcaster } from "./broadcaster.ts";
import { getBroadcastManager } from "./broadcast-manager.ts";

function asChannelList(channels: string | string[]): string[] {
  return Array.isArray(channels) ? channels : [channels];
}

function prefixChannels(
  channels: string | string[],
  prefix: "private-" | "presence-",
): string[] {
  return asChannelList(channels).map((c) =>
    c.startsWith(prefix) ? c : `${prefix}${c}`,
  );
}

/**
 * Fluent anonymous broadcast (Laravel `Broadcast::on()` / `private()` / `presence()`).
 */
export class AnonymousBroadcast {
  #channels: string[];
  #event = "AnonymousEvent";
  #payload: Record<string, unknown> = {};
  #connection: string | null = null;
  #toOthers = false;

  constructor(channels: string | string[]) {
    this.#channels = asChannelList(channels);
  }

  static on(channels: string | string[]): AnonymousBroadcast {
    return new AnonymousBroadcast(channels);
  }

  static private(channels: string | string[]): AnonymousBroadcast {
    return new AnonymousBroadcast(prefixChannels(channels, "private-"));
  }

  static presence(channels: string | string[]): AnonymousBroadcast {
    return new AnonymousBroadcast(prefixChannels(channels, "presence-"));
  }

  as(event: string): this {
    this.#event = event;
    return this;
  }

  with(payload: Record<string, unknown>): this {
    this.#payload = payload;
    return this;
  }

  via(connection: string): this {
    this.#connection = connection;
    return this;
  }

  toOthers(): this {
    this.#toOthers = true;
    return this;
  }

  async send(): Promise<void> {
    return this.sendNow();
  }

  async sendNow(): Promise<void> {
    const manager = getBroadcastManager();
    const driver: Broadcaster = this.#connection
      ? manager.driver(this.#connection)
      : manager.driver();
    const payload = { ...this.#payload };
    if (this.#toOthers) {
      const socket = manager.socket();
      if (socket) payload.socket_id = socket;
    }
    await driver.broadcast(this.#channels, this.#event, payload);
  }
}
