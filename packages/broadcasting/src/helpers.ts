import type { Broadcaster } from "./broadcaster.ts";
import type { ShouldBroadcast } from "./should-broadcast.ts";
import {
  getBroadcastManager,
  setBroadcastManager,
} from "./broadcast-manager.ts";

let defaultBroadcaster: Broadcaster | undefined;

export function setBroadcaster(broadcaster: Broadcaster): void {
  defaultBroadcaster = broadcaster;
  const manager = getBroadcastManager();
  manager.setDriver("default", broadcaster);
  manager.setDefaultDriver("default");
}

export function getBroadcaster(): Broadcaster {
  if (defaultBroadcaster) return defaultBroadcaster;
  return getBroadcastManager().driver();
}

/** Laravel `broadcast(new OrderShipped(...))`. */
export async function broadcast(event: ShouldBroadcast): Promise<void> {
  await getBroadcastManager().event(event);
}

export { setBroadcastManager, getBroadcastManager };
