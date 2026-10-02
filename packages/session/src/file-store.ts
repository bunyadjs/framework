import type { SessionStore } from "@bunyad/contracts";
import { mkdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";

export type FileSessionStoreOptions = {
  /** Directory for session files (created if missing). */
  path: string;
  /**
   * Session lifetime in minutes.
   * Files older than this are treated as missing on read.
   */
  lifetime?: number;
};

/**
 * File session driver — one JSON file per session id.
 */
export class FileSessionStore implements SessionStore {
  readonly #path: string;
  readonly #lifetimeMs: number | undefined;
  #ready: Promise<void>;

  constructor(options: FileSessionStoreOptions) {
    this.#path = options.path;
    this.#lifetimeMs =
      options.lifetime !== undefined
        ? options.lifetime * 60 * 1000
        : undefined;
    this.#ready = mkdir(this.#path, { recursive: true }).then(() => undefined);
  }

  #file(id: string): string {
    return join(this.#path, `${id}.json`);
  }

  async read(id: string): Promise<Record<string, unknown> | undefined> {
    await this.#ready;
    const path = this.#file(id);
    const file = Bun.file(path);
    if (!(await file.exists())) return undefined;

    if (this.#lifetimeMs !== undefined) {
      const meta = await stat(path);
      if (Date.now() - meta.mtimeMs > this.#lifetimeMs) {
        await this.destroy(id);
        return undefined;
      }
    }

    return (await file.json()) as Record<string, unknown>;
  }

  async write(id: string, data: Record<string, unknown>): Promise<void> {
    await this.#ready;
    await Bun.write(this.#file(id), JSON.stringify(data));
  }

  async destroy(id: string): Promise<void> {
    await this.#ready;
    const file = this.#file(id);
    if (await Bun.file(file).exists()) {
      await unlink(file);
    }
  }
}
