import type { SessionStore } from "@bunyad/contracts";

/** In-memory store — tests and single-process apps. */
export class MemorySessionStore implements SessionStore {
  readonly #data = new Map<string, Record<string, unknown>>();

  async read(id: string) {
    const row = this.#data.get(id);
    return row ? { ...row } : undefined;
  }

  async write(id: string, data: Record<string, unknown>) {
    this.#data.set(id, { ...data });
  }

  async destroy(id: string) {
    this.#data.delete(id);
  }
}
