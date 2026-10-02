import { MemoryCacheStore } from "./memory-store.ts";

/**
 * In-memory cache for tests.
 */
export class CacheFake extends MemoryCacheStore {
  async assertHas(key: string): Promise<void> {
    if (!(await this.has(key))) {
      throw new Error(`Expected cache key [${key}] to be set.`);
    }
  }

  async assertMissing(key: string): Promise<void> {
    if (await this.has(key)) {
      throw new Error(`Expected cache key [${key}] to be missing.`);
    }
  }

  async assertHasValue(key: string, value: unknown): Promise<void> {
    const hit = await this.get(key);
    if (!Bun.deepEquals(hit, value)) {
      throw new Error(`Expected cache key [${key}] to equal the given value.`);
    }
  }
}
