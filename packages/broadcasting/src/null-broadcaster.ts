import type { Broadcaster } from "./broadcaster.ts";

/**
 * No-op broadcaster (Laravel `null` driver).
 */
export class NullBroadcaster implements Broadcaster {
  async broadcast(
    _channels: string[],
    _event: string,
    _payload: Record<string, unknown>,
  ): Promise<void> {
    // intentionally empty
  }
}
