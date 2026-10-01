/**
 * Broadcast notification payload (pushed via the app broadcaster).
 */
export class BroadcastMessage {
  constructor(readonly data: Record<string, unknown>) {}

  #event?: string;

  /** Override the broadcast event name (defaults to the notification class name). */
  event(name: string): this {
    this.#event = name;
    return this;
  }

  eventName(fallback: string): string {
    return this.#event ?? fallback;
  }
}
