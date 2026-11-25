import type { SessionStore } from "@bunyad/contracts";
import { mkdir, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";

/** Unique temp names without touching the crypto API on every save. */
let tempSeq = 0;

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
    const file = Bun.file(this.#file(id));

    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }

    if (
      this.#lifetimeMs !== undefined &&
      Date.now() - file.lastModified > this.#lifetimeMs
    ) {
      await this.destroy(id);
      return undefined;
    }

    // `.json()` throws a stackless SyntaxError on an empty file. A truncated
    // save (Windows locks the file mid-write) must miss the session, not 500.
    return parseSession(text);
  }

  async write(id: string, data: Record<string, unknown>): Promise<void> {
    await this.#ready;
    const path = this.#file(id);
    tempSeq = (tempSeq + 1) >>> 0;
    const temp = `${path}.${process.pid}.${tempSeq}.tmp`;
    // Write the temp file, then rename over the live one. Replacing in place
    // truncates first, so a concurrent read can observe 0 bytes.
    await Bun.write(temp, JSON.stringify(data));
    try {
      await rename(temp, path);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async destroy(id: string): Promise<void> {
    await this.#ready;
    const file = this.#file(id);
    if (await Bun.file(file).exists()) {
      await unlink(file);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

/** Empty or truncated session files are treated as logged-out, not as a crash. */
function parseSession(text: string): Record<string, unknown> | undefined {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
