import type { Broadcaster } from "./broadcaster.ts";

/**
 * Logs broadcasts (dev / default).
 */
export class LogBroadcaster implements Broadcaster {
  async broadcast(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    console.log(
      `[broadcast] channels=${channels.join(",")} event=${event}`,
      payload,
    );
  }
}
