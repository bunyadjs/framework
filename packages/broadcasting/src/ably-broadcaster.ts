import type { Broadcaster } from "./broadcaster.ts";

export type AblyBroadcasterOptions = {
  /** Ably API key (`keyName.keySecret` or full root key). */
  apiKey: string;
  /** Override REST host (default `rest.ably.io`). */
  host?: string;
  fetch?: typeof fetch;
};

/**
 * Ably REST publish adapter.
 */
export class AblyBroadcaster implements Broadcaster {
  readonly #apiKey: string;
  readonly #host: string;
  readonly #fetch: typeof fetch;

  constructor(options: AblyBroadcasterOptions) {
    this.#apiKey = options.apiKey;
    this.#host = options.host ?? "rest.ably.io";
    this.#fetch = options.fetch ?? fetch;
  }

  async broadcast(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const auth = `Basic ${btoa(this.#apiKey)}`;
    for (const channel of channels) {
      const url = `https://${this.#host}/channels/${encodeURIComponent(channel)}/messages`;
      const res = await this.#fetch(url, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: event,
          data: payload,
        }),
      });
      if (!res.ok) {
        throw new Error(
          `Ably broadcast failed on [${channel}]: ${res.status} ${await res.text()}`,
        );
      }
    }
  }
}
