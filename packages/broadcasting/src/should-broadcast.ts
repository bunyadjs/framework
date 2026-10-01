import { Event } from "@bunyad/events";

/**
 * Marker for events that should be broadcast when dispatched via `broadcast()`.
 * Laravel `ShouldBroadcast` / `Illuminate\Contracts\Broadcasting\ShouldBroadcast`.
 */
export abstract class ShouldBroadcast extends Event {
  /** Channel name(s) — `private-user.1`, `orders`, etc. */
  abstract broadcastOn(): string | string[];

  /** Event name clients listen for (defaults to class name). */
  broadcastAs(): string {
    return this.constructor.name;
  }

  /** Payload sent to clients. */
  broadcastWith(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(this)) {
      out[key] = (this as Record<string, unknown>)[key];
    }
    return out;
  }

  /** Laravel `broadcastWhen()` — return false to skip broadcasting. */
  broadcastWhen(): boolean {
    return true;
  }

  /** Laravel `broadcastConnection()` — named driver, or null for default. */
  broadcastConnection(): string | null {
    return null;
  }

  /** Queue name for `Broadcast.queue` (default queue when omitted). */
  broadcastQueue(): string | null {
    return null;
  }
}

/**
 * Broadcast immediately (Laravel `ShouldBroadcastNow`).
 * Without a queue binding, `Broadcast.queue` already sends now — this marker
 * documents intent for app code / future queue wiring.
 */
export abstract class ShouldBroadcastNow extends ShouldBroadcast {}
