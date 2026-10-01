import type { CacheRepository } from "./repository.ts";
import { CacheLock } from "./lock.ts";

export class LimiterTimeoutException extends Error {
  constructor(message = "Unable to acquire concurrency limiter slot.") {
    super(message);
    this.name = "LimiterTimeoutException";
  }
}

/**
 * Limits how many concurrent executions may hold a named resource.
 * Built via `Cache.funnel(name)`.
 */
export class ConcurrencyLimiterBuilder {
  #limit = 1;
  #releaseAfter = 60;
  #blockSeconds = 0;

  constructor(
    private readonly repository: CacheRepository,
    private readonly name: string,
  ) {}

  /** Maximum concurrent holders (default 1). */
  limit(max: number): this {
    this.#limit = Math.max(1, Math.trunc(max));
    return this;
  }

  /** Seconds before an acquired slot auto-releases (default 60). */
  releaseAfter(seconds: number): this {
    this.#releaseAfter = Math.max(1, Math.trunc(seconds));
    return this;
  }

  /** Seconds to wait for a free slot (0 = try once, no wait). */
  block(seconds: number): this {
    this.#blockSeconds = Math.max(0, Math.trunc(seconds));
    return this;
  }

  /**
   * Acquire a slot and run `success`. When the wait times out, run `failure`
   * if provided; otherwise throw `LimiterTimeoutException`.
   */
  async then<T, F = never>(
    success: () => T | Promise<T>,
    failure?: () => F | Promise<F>,
  ): Promise<T | F> {
    const acquired = await this.#acquireSlot();
    if (!acquired) {
      if (failure) return await failure();
      throw new LimiterTimeoutException(
        `Unable to acquire funnel [${this.name}] within ${this.#blockSeconds} seconds.`,
      );
    }
    try {
      return await success();
    } finally {
      await acquired.release();
    }
  }

  async #acquireSlot(): Promise<CacheLock | null> {
    const deadline =
      this.#blockSeconds > 0
        ? Date.now() + this.#blockSeconds * 1000
        : Date.now();

    for (;;) {
      for (let slot = 0; slot < this.#limit; slot++) {
        const lock = this.repository.lock(
          `funnel:${this.name}:${slot}`,
          this.#releaseAfter,
        );
        if (await lock.get()) return lock;
      }
      if (Date.now() >= deadline) return null;
      await Bun.sleep(50);
    }
  }
}
