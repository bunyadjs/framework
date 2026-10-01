/**
 * Broadcast driver contract.
 */
export interface Broadcaster {
  broadcast(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
}
