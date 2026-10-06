export type EventClass = abstract new (...args: any[]) => object;

type DispatchedPredicate = (event: object) => boolean;

export type DispatchOptions = {
  /** Hold the event until the outermost DB transaction commits. */
  afterCommit?: boolean;
};

function eventWantsAfterCommit(
  event: object,
  options?: DispatchOptions,
): boolean {
  if (options?.afterCommit === true) return true;
  if (options?.afterCommit === false) return false;

  if (event instanceof ShouldDispatchAfterCommit) return true;

  const instance = event as { afterCommit?: unknown };
  if (instance.afterCommit === true) return true;

  const ctor = event.constructor as {
    afterCommit?: unknown;
  };
  if (ctor.afterCommit === true) return true;

  return false;
}

/** Reported after an event has run through its listeners. */
export type DispatchedEvent = {
  /** Class name, or the string name for named events. */
  name: string;
  payload: object;
  /** Exact plus wildcard listeners that were registered when it fired. */
  listeners: number;
  timeMs: number;
  /** A listener threw. */
  failed: boolean;
};

export type DispatchTap = (event: DispatchedEvent) => void;

const dispatchTaps = new Set<DispatchTap>();

/**
 * Observe every dispatched event (class and named, with or without listeners) after it ran.
 * Used by dev tooling; a throwing tap never affects dispatch. Returns unsubscribe.
 */
export function listenDispatched(tap: DispatchTap): () => void {
  dispatchTaps.add(tap);
  return () => {
    dispatchTaps.delete(tap);
  };
}

function notifyDispatched(event: DispatchedEvent): void {
  for (const tap of dispatchTaps) {
    try {
      tap(event);
    } catch {
      // A broken observer must never break dispatching.
    }
  }
}

/**
 * Detect class listeners (`handle` on prototype or static `handle`).
 * Plain function listeners are left as-is.
 */
function isClassListener(listener: unknown): listener is ListenerClass {
  if (typeof listener !== "function") return false;
  const fn = listener as Function & {
    handle?: unknown;
    prototype?: { handle?: unknown };
  };
  if (typeof fn.prototype?.handle === "function") return true;
  if (typeof fn.handle === "function") return true;
  return false;
}

export type ListenerClass<T = object> =
  | (new (...args: any[]) => { handle(event: T): unknown | Promise<unknown> })
  | (abstract new (...args: any[]) => {
      handle(event: T): unknown | Promise<unknown>;
    })
  | {
      handle(event: T): unknown | Promise<unknown>;
      new?(...args: any[]): unknown;
    };

export type ListenerInput<T = object> = Listener<T> | ListenerClass<T>;

type ListenerResolver = {
  make<T>(abstract: abstract new (...args: any[]) => T): T;
};

function resolveClassListener(
  Listener: ListenerClass,
  options: {
    container?: ListenerResolver;
    makeListener?: DispatcherOptions["makeListener"];
  } = {},
): Listener {
  const Ctor = Listener as Function & {
    handle?: (event: object) => unknown | Promise<unknown>;
    prototype?: { handle?: (event: object) => unknown | Promise<unknown> };
  };

  // Static-only handle (no instance method on prototype).
  if (
    typeof Ctor.handle === "function" &&
    typeof Ctor.prototype?.handle !== "function"
  ) {
    return (event) => Ctor.handle!(event);
  }

  return async (event) => {
    let instance: { handle(event: object): unknown | Promise<unknown> };

    if (options.makeListener) {
      instance = options.makeListener(Listener);
      return instance.handle(event);
    }

    if (options.container) {
      try {
        instance = options.container.make(
          Listener as new (...args: any[]) => {
            handle(event: object): unknown | Promise<unknown>;
          },
        );
      } catch {
        instance = new (Listener as new () => {
          handle(event: object): unknown | Promise<unknown>;
        })();
      }
      return instance.handle(event);
    }

    try {
      const { Container } = await import("@bunyad/container");
      const app = Container.getInstance() as ListenerResolver;
      if (typeof app?.make === "function") {
        try {
          instance = app.make(
            Listener as new (...args: any[]) => {
              handle(event: object): unknown | Promise<unknown>;
            },
          );
        } catch {
          instance = new (Listener as new () => {
            handle(event: object): unknown | Promise<unknown>;
          })();
        }
      } else {
        instance = new (Listener as new () => {
          handle(event: object): unknown | Promise<unknown>;
        })();
      }
    } catch {
      instance = new (Listener as new () => {
        handle(event: object): unknown | Promise<unknown>;
      })();
    }
    return instance.handle(event);
  };
}

function normalizeListener(
  listener: ListenerInput,
  options: {
    container?: ListenerResolver;
    makeListener?: DispatcherOptions["makeListener"];
  } = {},
): Listener {
  if (isClassListener(listener)) {
    return resolveClassListener(listener, options);
  }
  return listener as Listener;
}

/**
 * Base class for domain events (optional — plain objects work too).
 * Static helpers mirror `Event.fake()` / `Event.assertDispatched()`.
 */
export abstract class Event {
  /** Swap the default dispatcher for a recording fake. */
  static fake(eventsToFake?: Array<EventClass | string>): EventFake {
    const previous = defaultDispatcher;
    const fake = new EventFake(previous, eventsToFake);
    setEventDispatcher(fake);
    return fake;
  }

  static assertDispatched(
    type: EventClass | string,
    predicate?: DispatchedPredicate,
  ): void {
    requireFake().assertDispatched(type, predicate);
  }

  static assertNotDispatched(type: EventClass | string): void {
    requireFake().assertNotDispatched(type);
  }

  static assertNothingDispatched(): void {
    requireFake().assertNothingDispatched();
  }

  static assertDispatchedTimes(type: EventClass | string, times: number): void {
    requireFake().assertDispatchedTimes(type, times);
  }

  static assertListening(event: EventClass | string): void {
    if (!defaultDispatcher?.hasListeners(event)) {
      const label = typeof event === "string" ? event : event.name;
      throw new Error(`Expected listeners for event [${label}].`);
    }
  }

  /** `Event.dispatch($event)` — alias for `event()`. */
  static dispatch(
    instance: object,
    options?: DispatchOptions,
  ): Promise<object> {
    return defaultDispatcher!.dispatch(instance, options);
  }

  static until(instance: object): Promise<unknown> {
    return defaultDispatcher!.until(instance);
  }

  static listen(
    event: string | EventClass | Array<EventClass | string>,
    listener: ListenerInput,
    options?: ListenOptions,
  ): Dispatcher;
  static listen<T extends EventClass>(
    event: T | T[],
    listener: ListenerInput<InstanceType<T>>,
    options?: ListenOptions,
  ): Dispatcher;
  static listen(
    event: EventClass | string | Array<EventClass | string>,
    listener: ListenerInput,
    options?: ListenOptions,
  ): Dispatcher {
    return defaultDispatcher!.listen(event as never, listener as never, options);
  }

  static listenOnce(
    event: EventClass | string,
    listener: ListenerInput,
  ): Dispatcher {
    return defaultDispatcher!.listenOnce(event as never, listener as never);
  }

  static subscribe(
    subscriber: EventSubscriber | EventSubscriberClass,
  ): Dispatcher {
    return defaultDispatcher!.subscribe(subscriber);
  }

  static forget(event: EventClass | string): void {
    defaultDispatcher!.forget(event);
  }

  /** Dispatch pushed events for a name. */
  static flush(name: string): Promise<void>;
  /** Clear all listeners (Bunyad convenience). */
  static flush(): void;
  static flush(name?: string): void | Promise<void> {
    return defaultDispatcher!.flush(name as never);
  }

  /** Dispatch every pushed event. */
  static flushPushed(): Promise<void> {
    return defaultDispatcher!.flushPushed();
  }

  static hasListeners(event: EventClass | string): boolean {
    return defaultDispatcher!.hasListeners(event);
  }

  static push(name: string, payload: object = {}): void {
    defaultDispatcher!.push(name, payload);
  }

  static forgetPushed(): void {
    defaultDispatcher!.forgetPushed();
  }

  static defer<T>(callback: () => T | Promise<T>): Promise<T> {
    return defaultDispatcher!.defer(callback);
  }
}

/**
 * Event base that defers dispatch until the outermost DB transaction commits.
 * Apps may also set `afterCommit = true` on any event instance or class.
 */
export abstract class ShouldDispatchAfterCommit extends Event {
  afterCommit = true;
}

export type Listener<T = object> = (
  event: T,
) => unknown | Promise<unknown>;

export type ListenOptions = {
  once?: boolean;
  /** When true, listener is pushed onto the queue instead of run inline. */
  queued?: boolean;
};

export type QueuePusher = (
  listener: Listener,
  event: object,
) => void | Promise<void>;

type ListenerEntry = {
  listener: Listener;
  once: boolean;
  queued: boolean;
};

export type DispatcherOptions = {
  /** Used when a listener is registered with `{ queued: true }`. */
  queue?: QueuePusher;
  /** Optional container for resolving class listeners via `make`. */
  container?: ListenerResolver;
  /** Override class-listener construction (tests / custom DI). */
  makeListener?: (Listener: ListenerClass) => {
    handle(event: object): unknown | Promise<unknown>;
  };
  /** Override after-commit scheduling (tests / custom). */
  afterCommit?: (callback: () => void | Promise<void>) => void;
};

type PushedEvent = { name: string; payload: object };

/**
 * Event dispatcher (`Event.listen` / `dispatch` / `until` / `push`).
 */
export class Dispatcher {
  readonly #listeners = new Map<EventClass | string, ListenerEntry[]>();
  readonly #wildcards = new Map<string, ListenerEntry[]>();
  readonly #queue?: QueuePusher;
  readonly #container?: ListenerResolver;
  readonly #makeListener?: DispatcherOptions["makeListener"];
  readonly #afterCommitHook?: DispatcherOptions["afterCommit"];
  readonly #pushed: PushedEvent[] = [];
  #deferred: object[] | null = null;
  #deferDepth = 0;

  constructor(options: DispatcherOptions = {}) {
    this.#queue = options.queue;
    this.#container = options.container;
    this.#makeListener = options.makeListener;
    this.#afterCommitHook = options.afterCommit;
  }

  #registerListener(
    event: EventClass | string,
    listener: ListenerInput,
    options: ListenOptions,
  ): this {
    const entry: ListenerEntry = {
      listener: normalizeListener(listener, {
        container: this.#container,
        makeListener: this.#makeListener,
      }),
      once: options.once ?? false,
      queued: options.queued ?? false,
    };

    if (typeof event === "string" && event.includes("*")) {
      const list = this.#wildcards.get(event) ?? [];
      list.push(entry);
      this.#wildcards.set(event, list);
      return this;
    }

    const list = this.#listeners.get(event) ?? [];
    list.push(entry);
    this.#listeners.set(event, list);
    return this;
  }

  listen(
    event: string | EventClass | Array<EventClass | string>,
    listener: ListenerInput,
    options?: ListenOptions,
  ): this;
  listen<T extends EventClass>(
    event: T | T[],
    listener: ListenerInput<InstanceType<T>>,
    options?: ListenOptions,
  ): this;
  listen(
    event: EventClass | string | Array<EventClass | string>,
    listener: ListenerInput,
    options: ListenOptions = {},
  ): this {
    const events = Array.isArray(event) ? event : [event];
    for (const e of events) {
      this.#registerListener(e, listener, options);
    }
    return this;
  }

  /** Register a one-shot listener. */
  listenOnce(event: string, listener: ListenerInput): this;
  listenOnce<T extends EventClass>(
    event: T,
    listener: ListenerInput<InstanceType<T>>,
  ): this;
  listenOnce(event: EventClass | string, listener: ListenerInput): this {
    return this.#registerListener(event, listener, { once: true });
  }

  /** Listeners for an event (exact + matching wildcards). */
  getListeners(event: EventClass | string): Listener[] {
    return this.#entriesFor(event).map((e) => e.listener);
  }

  /** Raw listener map. */
  getRawListeners(): Record<string, Listener[]> {
    const out: Record<string, Listener[]> = {};
    for (const [key, list] of this.#listeners) {
      const label = typeof key === "string" ? key : key.name;
      out[label] = list.map((e) => e.listener);
    }
    for (const [key, list] of this.#wildcards) {
      out[key] = list.map((e) => e.listener);
    }
    return out;
  }

  hasWildcardListeners(event?: string): boolean {
    if (event === undefined) return this.#wildcards.size > 0;
    return this.#wildcardMatches(event).length > 0;
  }

  /** Wildcard listeners that match a named event (or all wildcard listeners). */
  getWildcardListeners(event?: string): Listener[] {
    if (event === undefined) {
      const all: Listener[] = [];
      for (const list of this.#wildcards.values()) {
        for (const entry of list) all.push(entry.listener);
      }
      return all;
    }
    return this.#wildcardMatches(event).map((e) => e.listener);
  }

  #wildcardMatches(name: string): ListenerEntry[] {
    const matched: ListenerEntry[] = [];
    for (const [pattern, list] of this.#wildcards) {
      if (matchWildcard(name, pattern)) matched.push(...list);
    }
    return matched;
  }

  #entriesFor(event: EventClass | string): ListenerEntry[] {
    const exact = this.#listeners.get(event) ?? [];
    if (typeof event === "string") {
      return [...exact, ...this.#wildcardMatches(event)];
    }
    return exact;
  }

  async #invoke(
    eventOrPayload: object,
    listKey: EventClass | string,
    halt: boolean,
  ): Promise<unknown> {
    if (dispatchTaps.size === 0) return this.#run(eventOrPayload, listKey, halt);

    const start = performance.now();
    const listeners =
      (this.#listeners.get(listKey)?.length ?? 0) +
      (typeof listKey === "string" ? this.#wildcardMatches(listKey).length : 0);
    let failed = true;
    try {
      const result = await this.#run(eventOrPayload, listKey, halt);
      failed = false;
      return result;
    } finally {
      notifyDispatched({
        name: typeof listKey === "string" ? listKey : listKey.name,
        payload: eventOrPayload,
        listeners,
        timeMs: performance.now() - start,
        failed,
      });
    }
  }

  async #run(
    eventOrPayload: object,
    listKey: EventClass | string,
    halt: boolean,
  ): Promise<unknown> {
    const exact = [...(this.#listeners.get(listKey) ?? [])];
    const wild =
      typeof listKey === "string" ? [...this.#wildcardMatches(listKey)] : [];
    const combined = [...exact, ...wild];
    if (!combined.length) return halt ? null : eventOrPayload;

    const consumedOnce = new Set<ListenerEntry>();
    let haltResult: unknown = null;

    for (const entry of combined) {
      let result: unknown;
      if (entry.queued) {
        if (!this.#queue) {
          throw new Error(
            "Queued listener requires Dispatcher({ queue }) to be configured.",
          );
        }
        await this.#queue(entry.listener, eventOrPayload);
        result = undefined;
      } else {
        result = await entry.listener(eventOrPayload);
      }

      if (entry.once) consumedOnce.add(entry);

      if (halt && result !== null && result !== undefined) {
        haltResult = result;
        break;
      }
    }

    if (exact.length) {
      this.#listeners.set(
        listKey,
        exact.filter((entry) => !consumedOnce.has(entry)),
      );
    }

    if (typeof listKey === "string") {
      for (const [pattern, wlist] of this.#wildcards) {
        if (!matchWildcard(listKey, pattern)) continue;
        this.#wildcards.set(
          pattern,
          wlist.filter((entry) => !consumedOnce.has(entry)),
        );
      }
    }

    return halt ? haltResult : eventOrPayload;
  }

  async #dispatchNow(event: object): Promise<object> {
    if (this.#deferred) {
      this.#deferred.push(event);
      return event;
    }
    await this.#invoke(event, event.constructor as EventClass, false);
    if (shouldBroadcastHandler) {
      await shouldBroadcastHandler(event);
    }
    return event;
  }

  async #scheduleAfterCommit(callback: () => void | Promise<void>): Promise<void> {
    if (this.#afterCommitHook) {
      this.#afterCommitHook(callback);
      return;
    }
    const { afterCommit } = await import("@bunyad/database");
    afterCommit(callback);
  }

  async dispatch(
    event: object,
    options?: DispatchOptions,
  ): Promise<object> {
    if (eventWantsAfterCommit(event, options)) {
      await this.#scheduleAfterCommit(() => {
        void this.#dispatchNow(event);
      });
      return event;
    }
    return this.#dispatchNow(event);
  }

  /**
   * Dispatch and halt on the first non-null listener return value.
   */
  async until(event: object): Promise<unknown> {
    if (this.#deferred) {
      this.#deferred.push(event);
      return null;
    }
    return this.#invoke(event, event.constructor as EventClass, true);
  }

  /** Dispatch by string name with payload. */
  async dispatchAs(name: string, payload: object = {}): Promise<object> {
    if (this.#deferred) {
      this.#deferred.push({ __named: name, ...payload });
      return payload;
    }
    await this.#invoke(payload, name, false);
    return payload;
  }

  async untilAs(name: string, payload: object = {}): Promise<unknown> {
    if (this.#deferred) {
      this.#deferred.push({ __named: name, ...payload });
      return null;
    }
    return this.#invoke(payload, name, true);
  }

  /**
   * Queue a named event for later flush.
   */
  push(name: string, payload: object = {}): void {
    this.#pushed.push({ name, payload });
  }

  /** Dispatch all pushed events for a name. */
  async flush(name: string): Promise<void>;
  /** Clear all listeners (Bunyad convenience). */
  flush(): void;
  flush(name?: string): void | Promise<void> {
    if (name === undefined) {
      this.flushListeners();
      return;
    }
    return this.#flushPushed(name);
  }

  /** Dispatch every pushed event. */
  async flushPushed(): Promise<void> {
    return this.#flushPushed();
  }

  async #flushPushed(name?: string): Promise<void> {
    const pending = name
      ? this.#pushed.filter((p) => p.name === name)
      : [...this.#pushed];
    if (name) {
      for (let i = this.#pushed.length - 1; i >= 0; i--) {
        if (this.#pushed[i]!.name === name) this.#pushed.splice(i, 1);
      }
    } else {
      this.#pushed.length = 0;
    }
    for (const item of pending) {
      await this.dispatchAs(item.name, item.payload);
    }
  }

  forgetPushed(): void {
    this.#pushed.length = 0;
  }

  /**
   * Defer event dispatch until the callback finishes.
   */
  async defer<T>(callback: () => T | Promise<T>): Promise<T> {
    this.#deferDepth += 1;
    if (this.#deferred === null) this.#deferred = [];
    // Snapshot so a thrown frame can discard only its own deferred events.
    const startIndex = this.#deferred.length;
    try {
      return await callback();
    } catch (error) {
      if (this.#deferred) this.#deferred.length = startIndex;
      throw error;
    } finally {
      this.#deferDepth -= 1;
      if (this.#deferDepth === 0 && this.#deferred) {
        const pending = this.#deferred;
        this.#deferred = null;
        for (const item of pending) {
          if (
            item &&
            typeof item === "object" &&
            "__named" in item &&
            typeof (item as { __named?: unknown }).__named === "string"
          ) {
            const { __named, ...payload } = item as {
              __named: string;
              [k: string]: unknown;
            };
            await this.dispatchAs(__named, payload);
          } else {
            await this.dispatch(item);
          }
        }
      }
    }
  }

  forget(event: EventClass | string): void {
    this.#listeners.delete(event);
    if (typeof event === "string") this.#wildcards.delete(event);
  }

  flushListeners(): void {
    this.#listeners.clear();
    this.#wildcards.clear();
  }

  hasListeners(event: EventClass | string): boolean {
    if ((this.#listeners.get(event)?.length ?? 0) > 0) return true;
    if (typeof event === "string") {
      return this.#wildcardMatches(event).length > 0 || this.#wildcards.has(event);
    }
    return false;
  }

  /**
   * Register an event subscriber (`Event.subscribe`).
   */
  subscribe(
    subscriber: EventSubscriber | EventSubscriberClass,
  ): this {
    const instance =
      typeof subscriber === "function"
        ? new (subscriber as EventSubscriberClass)()
        : subscriber;
    const mapped = instance.subscribe(this);
    if (!mapped) return this;

    if (Array.isArray(mapped)) {
      for (const [event, listener] of mapped) {
        this.listen(
          event,
          resolveSubscriberListener(instance, listener),
        );
      }
      return this;
    }

    for (const [event, listener] of Object.entries(mapped)) {
      this.listen(event, resolveSubscriberListener(instance, listener));
    }
    return this;
  }
}

function matchWildcard(name: string, pattern: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(name);
}

export type EventSubscriber = {
  subscribe(
    events: Dispatcher,
  ):
    | void
    | Record<string, Listener | string>
    | Array<[EventClass | string, Listener | string]>;
};

export type EventSubscriberClass = new () => EventSubscriber;

function resolveSubscriberListener(
  instance: EventSubscriber,
  listener: Listener | string,
): Listener {
  if (typeof listener === "string") {
    const method = (instance as Record<string, unknown>)[listener];
    if (typeof method !== "function") {
      throw new Error(
        `Event subscriber method [${listener}] is not defined.`,
      );
    }
    return (method as Listener).bind(instance);
  }
  return listener.bind(instance);
}

let defaultDispatcher: Dispatcher | undefined;

/** Optional hook so `event(ShouldBroadcast)` fans out via broadcasting. */
let shouldBroadcastHandler:
  | ((event: object) => void | Promise<void>)
  | undefined;

export function setShouldBroadcastHandler(
  handler: ((event: object) => void | Promise<void>) | undefined,
): void {
  shouldBroadcastHandler = handler;
}

export function setEventDispatcher(dispatcher: Dispatcher): void {
  defaultDispatcher = dispatcher;
}

export function getEventDispatcher(): Dispatcher {
  return defaultDispatcher!;
}

function requireFake(): EventFake {
  if (!(defaultDispatcher instanceof EventFake)) {
    throw new Error("Call Event.fake() before asserting dispatches.");
  }
  return defaultDispatcher;
}

/**
 * Records dispatches instead of invoking listeners (`Event.fake()`).
 */
export class EventFake extends Dispatcher {
  readonly #dispatched: object[] = [];
  readonly #named: Array<{ name: string; payload: object }> = [];
  readonly #previous?: Dispatcher;
  readonly #eventsToFake?: Set<EventClass | string>;

  constructor(
    previous?: Dispatcher,
    eventsToFake?: Array<EventClass | string>,
  ) {
    super();
    this.#previous = previous;
    this.#eventsToFake = eventsToFake ? new Set(eventsToFake) : undefined;
  }

  #shouldFake(event: EventClass | string): boolean {
    if (!this.#eventsToFake) return true;
    return this.#eventsToFake.has(event);
  }

  override async dispatch(
    event: object,
    options?: DispatchOptions,
  ): Promise<object> {
    const type = event.constructor as EventClass;
    if (!this.#shouldFake(type) && this.#previous) {
      return this.#previous.dispatch(event, options);
    }

    const record = () => {
      this.#dispatched.push(event);
    };

    if (eventWantsAfterCommit(event, options)) {
      const { afterCommit } = await import("@bunyad/database");
      afterCommit(() => {
        record();
      });
      return event;
    }

    record();
    return event;
  }

  override async until(event: object): Promise<unknown> {
    await this.dispatch(event);
    return null;
  }

  override async dispatchAs(name: string, payload: object = {}): Promise<object> {
    if (!this.#shouldFake(name) && this.#previous) {
      return this.#previous.dispatchAs(name, payload);
    }
    this.#named.push({ name, payload });
    return payload;
  }

  dispatched(type?: EventClass): object[] {
    if (!type) return [...this.#dispatched];
    return this.#dispatched.filter((e) => e.constructor === type);
  }

  assertDispatched(
    type: EventClass | string,
    predicate?: DispatchedPredicate,
  ): void {
    const matches =
      typeof type === "string"
        ? this.#named.filter((n) => n.name === type).map((n) => n.payload)
        : this.dispatched(type);
    const found = predicate ? matches.some(predicate) : matches.length > 0;
    if (!found) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(`Expected event [${label}] to be dispatched.`);
    }
  }

  assertNotDispatched(type: EventClass | string): void {
    const count =
      typeof type === "string"
        ? this.#named.filter((n) => n.name === type).length
        : this.dispatched(type).length;
    if (count > 0) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(`Unexpected event [${label}] was dispatched.`);
    }
  }

  assertDispatchedTimes(type: EventClass | string, times: number): void {
    const count =
      typeof type === "string"
        ? this.#named.filter((n) => n.name === type).length
        : this.dispatched(type).length;
    if (count !== times) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(
        `Expected event [${label}] to be dispatched ${times} time(s), got ${count}.`,
      );
    }
  }

  assertNothingDispatched(): void {
    if (this.#dispatched.length > 0 || this.#named.length > 0) {
      throw new Error(
        `Expected no events, got ${this.#dispatched.length + this.#named.length}.`,
      );
    }
  }

  override hasListeners(event: EventClass | string): boolean {
    if (super.hasListeners(event)) return true;
    return this.#previous?.hasListeners(event) ?? false;
  }

  /** Restore the previous dispatcher. */
  restore(): void {
    if (this.#previous) setEventDispatcher(this.#previous);
  }
}

/** `event(new UserRegistered(...))`. */
export function event(
  instance: object,
  options?: DispatchOptions,
): Promise<object> {
  return defaultDispatcher!.dispatch(instance, options);
}
