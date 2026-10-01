import type { Broadcaster } from "./broadcaster.ts";
import { getHubFanout } from "./presence-fanout.ts";
import type { SseHub } from "./sse-hub.ts";

/**
 * Pushes broadcasts to connected SSE subscribers (and Redis fan-out when configured).
 */
export class SseBroadcaster implements Broadcaster {
  constructor(readonly hub: SseHub) {}

  async broadcast(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.hub.publish(channels, event, payload);
    const fanout = getHubFanout();
    if (fanout) await fanout.publish(channels, event, payload);
  }
}
