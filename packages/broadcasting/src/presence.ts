import type { ChannelUser } from "./channels.ts";

export type PresenceMember = {
  id: string;
  info: Record<string, unknown>;
};

/**
 * Presence member list contract (memory or Redis).
 */
export interface PresenceRepository {
  join(
    channel: string,
    user: ChannelUser,
    info?: Record<string, unknown>,
  ): PresenceMember[] | Promise<PresenceMember[]>;
  leave(
    channel: string,
    userId: string | number,
  ): PresenceMember[] | Promise<PresenceMember[]>;
  members(channel: string): PresenceMember[] | Promise<PresenceMember[]>;
}

/**
 * In-memory presence member lists for `presence-*` channels.
 */
export class PresenceStore implements PresenceRepository {
  readonly #members = new Map<string, Map<string, PresenceMember>>();

  join(
    channel: string,
    user: ChannelUser,
    info: Record<string, unknown> = {},
  ): PresenceMember[] {
    const id = String(user.id);
    const map = this.#members.get(channel) ?? new Map();
    map.set(id, { id, info: { ...info, id: user.id } });
    this.#members.set(channel, map);
    return this.members(channel);
  }

  leave(channel: string, userId: string | number): PresenceMember[] {
    const map = this.#members.get(channel);
    if (!map) return [];
    map.delete(String(userId));
    if (map.size === 0) this.#members.delete(channel);
    return this.members(channel);
  }

  members(channel: string): PresenceMember[] {
    return [...(this.#members.get(channel)?.values() ?? [])];
  }

  here(channel: string): PresenceMember[] {
    return this.members(channel);
  }
}

let defaultPresence: PresenceRepository | undefined;

export function setPresenceStore(store: PresenceRepository): void {
  defaultPresence = store;
}

export function getPresenceStore(): PresenceRepository {
  return defaultPresence ?? (defaultPresence = new PresenceStore());
}
