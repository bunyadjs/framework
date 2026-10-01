import { RedisClient } from "bun";
import type { SseHub } from "./sse-hub.ts";

export type HubFanoutPayload = {
  /** Unique id of the publishing process — receivers ignore their own. */
  origin: string;
  channels: string[];
  event: string;
  payload: Record<string, unknown>;
};

/** @deprecated Use HubFanoutPayload */
export type PresenceFanoutPayload = HubFanoutPayload;

export type RedisHubFanoutOptions = {
  hub: SseHub;
  url?: string;
  /** Redis pub/sub channel (default `bunyad:hub:events`). */
  channel?: string;
  /** Shared publish client (must not be used for subscribe). */
  client?: RedisClient;
  origin?: string;
};

/** @deprecated Use RedisHubFanoutOptions */
export type RedisPresenceFanoutOptions = RedisHubFanoutOptions;

/**
 * Cross-process fan-out for SSE hub events (broadcasts + presence) via Redis pub/sub.
 */
export class RedisHubFanout {
  readonly #hub: SseHub;
  readonly #channel: string;
  readonly #origin: string;
  readonly #pub: RedisClient;
  #sub: RedisClient | undefined;
  #started = false;

  constructor(options: RedisHubFanoutOptions) {
    this.#hub = options.hub;
    this.#channel = options.channel ?? "bunyad:hub:events";
    this.#origin = options.origin ?? crypto.randomUUID();
    this.#pub = options.client ?? new RedisClient(options.url);
  }

  get origin(): string {
    return this.#origin;
  }

  /** Begin listening for remote hub events. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#pub.connect?.();
    this.#sub = await this.#pub.duplicate();
    await this.#sub.subscribe(this.#channel, (message) => {
      let data: HubFanoutPayload;
      try {
        data = JSON.parse(message) as HubFanoutPayload;
      } catch {
        return;
      }
      if (data.origin === this.#origin) return;
      this.#hub.publish(data.channels, data.event, data.payload);
    });
  }

  /** Publish to other workers (self ignored on receive). */
  async publish(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body: HubFanoutPayload = {
      origin: this.#origin,
      channels,
      event,
      payload,
    };
    await this.#pub.publish(this.#channel, JSON.stringify(body));
  }
}

/** Alias kept for existing imports. */
export class RedisPresenceFanout extends RedisHubFanout {}

let defaultFanout: RedisHubFanout | undefined;

export function setHubFanout(fanout: RedisHubFanout | undefined): void {
  defaultFanout = fanout;
}

export function getHubFanout(): RedisHubFanout | undefined {
  return defaultFanout;
}

export function setPresenceFanout(fanout: RedisHubFanout | undefined): void {
  setHubFanout(fanout);
}

export function getPresenceFanout(): RedisHubFanout | undefined {
  return getHubFanout();
}
