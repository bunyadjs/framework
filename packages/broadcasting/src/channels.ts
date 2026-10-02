export type ChannelUser = {
  id?: string | number;
  [key: string]: unknown;
};

export type ChannelAuthResult = boolean | Record<string, unknown>;

export type ChannelCallback = (
  user: ChannelUser | null,
  ...params: string[]
) => ChannelAuthResult | Promise<ChannelAuthResult>;

/**
 * Strip Pusher-style `private-` / `presence-` / `private-encrypted-` prefixes.
 */
export function normalizeChannelName(channelName: string): string {
  if (channelName.startsWith("private-encrypted-")) {
    return channelName.slice("private-encrypted-".length);
  }
  if (channelName.startsWith("private-")) {
    return channelName.slice("private-".length);
  }
  if (channelName.startsWith("presence-")) {
    return channelName.slice("presence-".length);
  }
  return channelName;
}

/**
 * `Broadcast::channel('orders.{id}', …)` registry.
 * Patterns may omit or include `private-`/`presence-` prefixes; authorize
 * matches both normalized and full client channel names.
 */
export class ChannelManager {
  readonly #channels = new Map<string, ChannelCallback>();

  channel(pattern: string, callback: ChannelCallback): this {
    this.#channels.set(pattern, callback);
    return this;
  }

  /** Resolve callback + params for a channel name, or `undefined`. */
  match(
    channelName: string,
  ): { callback: ChannelCallback; params: string[] } | undefined {
    const candidates = [channelName];
    const normalized = normalizeChannelName(channelName);
    if (normalized !== channelName) candidates.push(normalized);

    for (const [pattern, callback] of this.#channels) {
      for (const candidate of candidates) {
        const params = matchPattern(pattern, candidate);
        if (params) return { callback, params };
      }
    }
    return undefined;
  }

  async authorize(
    channelName: string,
    user: ChannelUser | null,
  ): Promise<ChannelAuthResult> {
    // Public channels (no private-/presence- prefix) are open
    if (
      !channelName.startsWith("private-") &&
      !channelName.startsWith("presence-")
    ) {
      return true;
    }

    const matched = this.match(channelName);
    if (!matched) return false;
    return matched.callback(user, ...matched.params);
  }
}

/** Convert `orders.{id}` / `private-user.{id}` against a channel name. */
export function matchPattern(
  pattern: string,
  channelName: string,
): string[] | null {
  const parts = pattern.split(".");
  const nameParts = channelName.split(".");
  if (parts.length !== nameParts.length) return null;

  const params: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const actual = nameParts[i]!;
    if (part.startsWith("{") && part.endsWith("}")) {
      params.push(actual);
    } else if (part !== actual) {
      return null;
    }
  }
  return params;
}

let defaultChannels: ChannelManager | undefined;

export function setChannelManager(manager: ChannelManager): void {
  defaultChannels = manager;
}

export function getChannelManager(): ChannelManager {
  return defaultChannels ?? (defaultChannels = new ChannelManager());
}

/** Compiled `routes/channels.ts` registrar (binary builds). */
export type ChannelRoutesLoader = () => void | Promise<void>;

let preloadedChannels: ChannelRoutesLoader | undefined;

export function setPreloadedChannels(
  loader: ChannelRoutesLoader | undefined,
): void {
  preloadedChannels = loader;
}

/** Consume the compiled channel registrar (clears the slot). */
export function takePreloadedChannels(): ChannelRoutesLoader | undefined {
  const loader = preloadedChannels;
  preloadedChannels = undefined;
  return loader;
}
