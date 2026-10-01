import { AsyncLocalStorage } from "node:async_hooks";
import { HeadBuilder } from "./builder.ts";
import type { HeadElement, ResolvedHead, TitleOptions } from "./types.ts";

export type HeadCallback = (head: HeadBuilder) => void;

type RequestState = {
  runtime: HeadBuilder;
  route: HeadBuilder[];
  error: HeadBuilder | null;
  url: string | undefined;
};

const storage = new AsyncLocalStorage<RequestState>();

function emptyRuntime(): HeadBuilder {
  return new HeadBuilder();
}

function createState(url?: string): RequestState {
  return {
    runtime: emptyRuntime(),
    route: [],
    error: null,
    url,
  };
}

/**
 * Request-scoped head metadata manager.
 */
export class HeadManager {
  #defaults: HeadCallback[] = [];
  #inertiaGlobals: HeadCallback[] = [];
  #inertiaProp = "head";
  #inertiaEnabled = true;
  /** Fallback when not inside `runWithHead`. */
  #fallback: RequestState = createState();

  defaults(callback: HeadCallback): this {
    this.#defaults.push(callback);
    return this;
  }

  inertiaGlobals(callback: HeadCallback): this {
    this.#inertiaGlobals.push(callback);
    return this;
  }

  inertia(options: { prop?: string; enabled?: boolean } = {}): this {
    if (options.prop != null) this.#inertiaProp = options.prop;
    if (options.enabled != null) this.#inertiaEnabled = options.enabled;
    return this;
  }

  inertiaProp(): string {
    return this.#inertiaProp;
  }

  inertiaEnabled(): boolean {
    return this.#inertiaEnabled;
  }

  /** Current request URL (for canonical resolution). */
  setUrl(url: string | undefined): this {
    this.#state().url = url;
    return this;
  }

  url(): string | undefined {
    return this.#state().url;
  }

  /** Runtime builder for this request (merged last among page layers). */
  runtime(): HeadBuilder {
    return this.#state().runtime;
  }

  /** Apply route / group metadata for the matched route. */
  applyRoute(callback: HeadCallback): this {
    const builder = new HeadBuilder();
    callback(builder);
    this.#state().route.push(builder);
    return this;
  }

  /** Error-page metadata (highest priority). */
  applyError(callback: HeadCallback): this {
    const builder = new HeadBuilder();
    callback(builder);
    this.#state().error = builder;
    return this;
  }

  resolve(requestUrl?: string): ResolvedHead {
    const state = this.#state();
    const url = requestUrl ?? state.url;
    const layers = [];

    for (const cb of this.#defaults) {
      const b = new HeadBuilder();
      cb(b);
      layers.push(b.layer());
    }
    for (const b of state.route) layers.push(b.layer());
    layers.push(state.runtime.layer());
    if (state.error) layers.push(state.error.layer());

    return HeadBuilder.merge(layers, url);
  }

  /** HTML for `@head` — page layers + inertia globals (no ownership attrs on globals). */
  toHtml(requestUrl?: string): string {
    const page = this.#pageElements(requestUrl);
    const globals = this.#globalElements();
    return [...globals, ...page].map((e) => e.html).join("\n");
  }

  /** Structured resolved metadata. */
  toArray(requestUrl?: string): ResolvedHead {
    return this.resolve(requestUrl);
  }

  /**
   * Page-managed elements for the Inertia `head` prop (with `data-inertia` keys).
   * Globals are excluded.
   */
  toInertia(requestUrl?: string): string[] {
    return this.#pageElements(requestUrl).map((e) => e.html);
  }

  #pageElements(requestUrl?: string): HeadElement[] {
    return HeadBuilder.toElements(this.resolve(requestUrl), {
      inertiaOwned: true,
    });
  }

  #globalElements(): HeadElement[] {
    if (this.#inertiaGlobals.length === 0) return [];
    const layers = [];
    for (const cb of this.#inertiaGlobals) {
      const b = new HeadBuilder();
      cb(b);
      layers.push(b.layer());
    }
    const resolved = HeadBuilder.merge(layers, this.#state().url);
    return HeadBuilder.toElements(resolved, { inertiaOwned: false });
  }

  #state(): RequestState {
    return storage.getStore() ?? this.#fallback;
  }

  /** Reset fallback state (tests). */
  flush(): void {
    this.#fallback = createState();
    this.#defaults = [];
    this.#inertiaGlobals = [];
    this.#inertiaProp = "head";
    this.#inertiaEnabled = true;
  }
}

let manager = new HeadManager();

export function getHeadManager(): HeadManager {
  return manager;
}

export function setHeadManager(instance: HeadManager): void {
  manager = instance;
}

/** Run `fn` with a fresh request-scoped head state. */
export function runWithHead<T>(
  fn: () => T,
  options: { url?: string } = {},
): T {
  return storage.run(createState(options.url), fn);
}

/** Proxy helpers used by the `Head` facade. */
export function headTitle(
  value: string,
  options: TitleOptions = {},
): HeadBuilder {
  return getHeadManager().runtime().title(value, options);
}
