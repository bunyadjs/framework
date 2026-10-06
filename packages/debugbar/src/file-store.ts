import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryDebugbarStore } from "./store.ts";
import type { DebugbarStore, Snapshot } from "./types.ts";

export type FileDebugbarStoreOptions = {
  /** Snapshots to keep. Default 50. */
  capacity?: number;
  /** Delete snapshots older than this. Default 24 hours. */
  maxAgeMs?: number;
};

const ID = /^[0-9a-f]{16}$/;
const FILE = /^(\d{13})-([0-9a-f]{16})\.json$/;

/**
 * Snapshots as JSON files, one per request: `<collectedAtMs>-<id>.json`, so a directory
 * listing is already time-ordered. A memory ring sits in front for the bar, writes are queued
 * behind the response, and other processes (an MCP server, a restarted dev server) read the
 * same directory. Snapshots are redacted before they reach any store.
 */
export class FileDebugbarStore implements DebugbarStore {
  readonly #memory: MemoryDebugbarStore;
  readonly #capacity: number;
  readonly #maxAgeMs: number;
  #writes: Promise<void> = Promise.resolve();

  constructor(
    readonly directory: string,
    options: FileDebugbarStoreOptions = {},
  ) {
    this.#capacity = options.capacity ?? 50;
    this.#maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
    this.#memory = new MemoryDebugbarStore(this.#capacity);
  }

  /** Cached immediately; the disk write is queued and never throws into the request. */
  put(snapshot: Snapshot): void {
    this.#memory.put(snapshot);
    this.#writes = this.#writes.then(() => this.#persist(snapshot)).catch(() => {});
  }

  async get(id: string): Promise<Snapshot | undefined> {
    if (!ID.test(id)) return undefined;
    const cached = this.#memory.get(id);
    if (cached) return cached;
    const name = (await this.#names()).find((entry) => entry.endsWith(`-${id}.json`));
    return name ? this.#read(name) : undefined;
  }

  async list(limit = this.#capacity): Promise<Snapshot[]> {
    const names = (await this.#names()).slice(0, limit);
    const out: Snapshot[] = [];
    for (const name of names) {
      const id = FILE.exec(name)![2]!;
      const snapshot = this.#memory.get(id) ?? (await this.#read(name));
      if (snapshot) out.push(snapshot);
    }
    return out;
  }

  async clear(): Promise<void> {
    this.#memory.clear();
    await this.flush();
    for (const name of await this.#names()) {
      await rm(join(this.directory, name), { force: true });
    }
  }

  /** Resolve once every queued write has landed (tests, shutdown). */
  async flush(): Promise<void> {
    await this.#writes;
  }

  async #persist(snapshot: Snapshot): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stamp = String(Date.parse(snapshot.collectedAt)).padStart(13, "0");
    const final = join(this.directory, `${stamp}-${snapshot.id}.json`);
    const temp = `${final}.tmp`;
    await writeFile(temp, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(temp, final);
    await this.#prune();
  }

  async #prune(): Promise<void> {
    const names = await this.#names();
    const cutoff = Date.now() - this.#maxAgeMs;
    for (const [index, name] of names.entries()) {
      const stamp = Number(FILE.exec(name)![1]);
      if (index >= this.#capacity || stamp < cutoff) {
        await rm(join(this.directory, name), { force: true });
      }
    }
  }

  /** Snapshot file names, newest first. Temp and foreign files are ignored. */
  async #names(): Promise<string[]> {
    try {
      return (await readdir(this.directory)).filter((name) => FILE.test(name)).sort().reverse();
    } catch {
      return [];
    }
  }

  async #read(name: string): Promise<Snapshot | undefined> {
    try {
      return JSON.parse(await readFile(join(this.directory, name), "utf8")) as Snapshot;
    } catch {
      // Half-written by another process, or hand-edited: skip it.
      return undefined;
    }
  }
}
