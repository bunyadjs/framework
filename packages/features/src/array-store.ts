import type { FeatureStore } from "./types.ts";

/**
 * In-memory driver (Laravel `array` driver).
 */
export class ArrayFeatureStore implements FeatureStore {
  readonly #data = new Map<string, unknown>();

  #key(name: string, scope: string): string {
    return `${name}\0${scope}`;
  }

  async get(name: string, scope: string): Promise<unknown | undefined> {
    const key = this.#key(name, scope);
    if (!this.#data.has(key)) return undefined;
    return this.#data.get(key);
  }

  async set(name: string, scope: string, value: unknown): Promise<void> {
    this.#data.set(this.#key(name, scope), value);
  }

  async delete(name: string, scope: string): Promise<void> {
    this.#data.delete(this.#key(name, scope));
  }

  async purge(name?: string | string[]): Promise<void> {
    if (name == null) {
      this.#data.clear();
      return;
    }
    const names = new Set(Array.isArray(name) ? name : [name]);
    for (const key of [...this.#data.keys()]) {
      const featureName = key.split("\0")[0]!;
      if (names.has(featureName)) this.#data.delete(key);
    }
  }
}
