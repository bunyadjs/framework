import { SseHub } from "./sse-hub.ts";

let defaultHub: SseHub | undefined;

export function setSseHub(hub: SseHub): void {
  defaultHub = hub;
}

export function getSseHub(): SseHub {
  return defaultHub ?? (defaultHub = new SseHub());
}
