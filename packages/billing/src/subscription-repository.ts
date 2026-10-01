import type {
  SubscriptionAttributes,
  SubscriptionRepository,
} from "./types.ts";

/** In-memory subscription store (tests / apps without a subscriptions table yet). */
export class ArraySubscriptionRepository implements SubscriptionRepository {
  #rows = new Map<string, SubscriptionAttributes[]>();

  async allForOwner(
    ownerId: string | number,
  ): Promise<SubscriptionAttributes[]> {
    return [...(this.#rows.get(String(ownerId)) ?? [])];
  }

  async save(
    ownerId: string | number,
    row: SubscriptionAttributes,
  ): Promise<SubscriptionAttributes> {
    const key = String(ownerId);
    const list = this.#rows.get(key) ?? [];
    let idx = list.findIndex((r) => r.stripeId === row.stripeId);
    if (idx < 0) idx = list.findIndex((r) => r.type === row.type);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    this.#rows.set(key, list);
    return row;
  }

  async forget(ownerId: string | number, type: string): Promise<void> {
    const key = String(ownerId);
    const list = (this.#rows.get(key) ?? []).filter((r) => r.type !== type);
    this.#rows.set(key, list);
  }

  async findByStripeId(stripeId: string): Promise<SubscriptionAttributes | null> {
    for (const list of this.#rows.values()) {
      const hit = list.find((r) => r.stripeId === stripeId);
      if (hit) return { ...hit };
    }
    return null;
  }

  clear(): void {
    this.#rows.clear();
  }
}
