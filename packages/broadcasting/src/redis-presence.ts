import { RedisClient } from "bun";
import type { ChannelUser } from "./channels.ts";
import type { PresenceMember, PresenceRepository } from "./presence.ts";

export type RedisPresenceStoreOptions = {
  url?: string;
  prefix?: string;
  client?: RedisClient;
};

/**
 * Redis-backed presence (shared across processes).
 * Uses a hash per channel: `bunyad:presence:{channel}` → userId → JSON info.
 */
export class RedisPresenceStore implements PresenceRepository {
  readonly #prefix: string;
  readonly #client: RedisClient;

  constructor(options: RedisPresenceStoreOptions = {}) {
    this.#prefix = options.prefix ?? "bunyad:presence:";
    this.#client = options.client ?? new RedisClient(options.url);
  }

  #key(channel: string): string {
    return `${this.#prefix}${channel}`;
  }

  async join(
    channel: string,
    user: ChannelUser,
    info: Record<string, unknown> = {},
  ): Promise<PresenceMember[]> {
    const id = String(user.id);
    const member: PresenceMember = {
      id,
      info: { ...info, id: user.id },
    };
    await this.#client.hset(this.#key(channel), id, JSON.stringify(member));
    return this.members(channel);
  }

  async leave(
    channel: string,
    userId: string | number,
  ): Promise<PresenceMember[]> {
    await this.#client.hdel(this.#key(channel), String(userId));
    return this.members(channel);
  }

  async members(channel: string): Promise<PresenceMember[]> {
    const raw = await this.#client.hgetall(this.#key(channel));
    if (!raw || typeof raw !== "object") return [];
    return Object.values(raw as Record<string, string>).map(
      (value) => JSON.parse(value) as PresenceMember,
    );
  }
}
