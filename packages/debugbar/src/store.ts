import type { DebugbarStore, Snapshot } from "./types.ts";

/** Ring-buffer store: keeps the newest `capacity` snapshots in memory. */
export class MemoryDebugbarStore implements DebugbarStore {
  readonly #items = new Map<string, Snapshot>();

  constructor(private capacity = 50) {}

  put(snapshot: Snapshot): void {
    this.#items.set(snapshot.id, snapshot);
    while (this.#items.size > this.capacity) {
      const oldest = this.#items.keys().next().value;
      if (oldest === undefined) break;
      this.#items.delete(oldest);
    }
  }

  get(id: string): Snapshot | undefined {
    return this.#items.get(id);
  }

  list(limit = this.capacity): Snapshot[] {
    return [...this.#items.values()].reverse().slice(0, limit);
  }

  clear(): void {
    this.#items.clear();
  }
}
