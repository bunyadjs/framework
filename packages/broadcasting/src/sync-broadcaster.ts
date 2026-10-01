import type { Broadcaster } from "./broadcaster.ts";

export type BroadcastListener = (
  event: string,
  payload: Record<string, unknown>,
  channel: string,
) => void | Promise<void>;

/**
 * In-process broadcaster — subscribers receive events immediately.
 */
export class SyncBroadcaster implements Broadcaster {
  readonly #listeners = new Map<string, BroadcastListener[]>();
  readonly sent: Array<{
    channels: string[];
    event: string;
    payload: Record<string, unknown>;
  }> = [];

  listen(channel: string, listener: BroadcastListener): this {
    const list = this.#listeners.get(channel) ?? [];
    list.push(listener);
    this.#listeners.set(channel, list);
    return this;
  }

  async broadcast(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.sent.push({ channels, event, payload });
    for (const channel of channels) {
      const list = this.#listeners.get(channel) ?? [];
      for (const listener of list) {
        await listener(event, payload, channel);
      }
      const wildcard = this.#listeners.get("*") ?? [];
      for (const listener of wildcard) {
        await listener(event, payload, channel);
      }
    }
  }
}
