import type { Job } from "./job.ts";
import {
  getQueue,
  QueueManager,
  setQueue,
  type QueueConnectionName,
  type QueueManagerOptions,
} from "./manager.ts";
import {
  clearQueueRoutes,
  queueRoutes,
  type QueueRouteTarget,
} from "./queue-routes.ts";

export type PushedJob = {
  name: string;
  data: unknown;
  queue: string;
  id: string;
  delay?: number;
  availableAt?: number;
  batchId?: string;
};

type PushPredicate = (job: PushedJob) => boolean;

export type QueueHook =
  | "before"
  | "after"
  | "exceptionOccurred"
  | "failing"
  | "looping"
  | "starting"
  | "stopping";

export type QueueHookCallback = (
  ...args: unknown[]
) => void | Promise<void>;

export type QueueConnector = (
  config?: Record<string, unknown>,
) => QueueManager;

function queue(): QueueManager {
  return getQueue();
}

/**
 * Records jobs instead of running them (`Queue::fake()`).
 */
export class QueueFake extends QueueManager {
  readonly #pushed: PushedJob[] = [];
  readonly #previous?: QueueManager;

  constructor(previous?: QueueManager, options: QueueManagerOptions = {}) {
    super({ ...options, connection: "memory" });
    this.#previous = previous;
  }

  override async push(
    name: string,
    data: unknown = {},
    queueName = "default",
    options: {
      attempts?: number;
      maxTries?: number;
      id?: string;
      delay?: number;
      availableAt?: number;
      chain?: unknown;
      batchId?: string;
      onChainFailure?: unknown;
    } = {},
  ): Promise<string> {
    const id = options.id ?? crypto.randomUUID();
    this.#pushed.push({
      name,
      data,
      queue: queueName,
      id,
      delay: options.delay,
      availableAt: options.availableAt,
      batchId: options.batchId,
    });
    return id;
  }

  pushed(name?: string | (new (...args: never[]) => Job)): PushedJob[] {
    if (!name) return [...this.#pushed];
    const label = typeof name === "string" ? name : name.name;
    return this.#pushed.filter((j) => j.name === label);
  }

  assertPushed(
    name: string | (new (...args: never[]) => Job),
    predicate?: PushPredicate,
  ): void {
    const matches = this.pushed(name);
    const found = predicate ? matches.some(predicate) : matches.length > 0;
    if (!found) {
      const label = typeof name === "string" ? name : name.name;
      throw new Error(`Expected job [${label}] to be pushed.`);
    }
  }

  assertNotPushed(name: string | (new (...args: never[]) => Job)): void {
    if (this.pushed(name).length > 0) {
      const label = typeof name === "string" ? name : name.name;
      throw new Error(`Unexpected job [${label}] was pushed.`);
    }
  }

  assertPushedTimes(
    name: string | (new (...args: never[]) => Job),
    times: number,
  ): void {
    const count = this.pushed(name).length;
    if (count !== times) {
      const label = typeof name === "string" ? name : name.name;
      throw new Error(
        `Expected job [${label}] to be pushed ${times} time(s), got ${count}.`,
      );
    }
  }

  assertNothingPushed(): void {
    if (this.#pushed.length > 0) {
      throw new Error(`Expected no jobs, got ${this.#pushed.length}.`);
    }
  }

  restore(): void {
    if (this.#previous) setQueue(this.#previous);
  }
}

let previousQueue: QueueManager | undefined;
const hooks = new Map<QueueHook, QueueHookCallback[]>();
const connectors = new Map<string, QueueConnector>();
const connections = new Map<string, QueueManager>();
const pausedUntil = new Map<string, number>();
let defaultDriverName = "sync";

function requireQueueFake(): QueueFake {
  const q = getQueue();
  if (!(q instanceof QueueFake)) {
    throw new Error("Call Queue.fake() before asserting pushed jobs.");
  }
  return q;
}

function addHook(name: QueueHook, callback: QueueHookCallback): void {
  const list = hooks.get(name) ?? [];
  list.push(callback);
  hooks.set(name, list);
}

/** Fire registered queue lifecycle hooks (used by workers). */
export async function fireQueueHook(
  name: QueueHook,
  ...args: unknown[]
): Promise<void> {
  for (const cb of hooks.get(name) ?? []) {
    await cb(...args);
  }
}

/**
 * Queue facade.
 */
export const Queue = {
  connection(name?: string | null): QueueManager {
    if (name == null || name === defaultDriverName) return queue();
    const existing = connections.get(name);
    if (existing) return existing;
    const connector = connectors.get(name);
    if (!connector) {
      throw new Error(`Queue connection [${name}] is not configured.`);
    }
    const created = connector();
    connections.set(name, created);
    return created;
  },

  connected(name?: string | null): boolean {
    if (name == null) return getQueue() != null;
    return connections.has(name) || name === defaultDriverName;
  },

  extend(name: string, connector: QueueConnector) {
    connectors.set(name, connector);
    return this;
  },

  /** Alias of {@link extend}. */
  addConnector(name: string, connector: QueueConnector) {
    return this.extend(name, connector);
  },

  getDefaultDriver(): string {
    return defaultDriverName;
  },

  setDefaultDriver(name: string) {
    defaultDriverName = name;
    return this;
  },

  /**
   * Laravel `Queue::route` — default connection/queue by job class, parent, or marker.
   *
   * ```ts
   * Queue.route(ProcessPodcast, { connection: "redis", queue: "podcasts" });
   * Queue.route(ProcessPodcast, "podcasts", "redis");
   * Queue.route([[RequiresVideo, { queue: "video" }]]);
   * ```
   */
  route(
    classOrMap:
      | string
      | Function
      | Array<[string | Function, string | [string | null, string | null] | QueueRouteTarget]>
      | Record<string, string | [string | null, string | null] | QueueRouteTarget>,
    queue?: string | null | QueueRouteTarget,
    connection?: string | null,
  ) {
    queueRoutes().set(classOrMap as never, queue as never, connection);
    return this;
  },

  /** Clear registered queue routes (tests). */
  clearRoutes() {
    clearQueueRoutes();
    return this;
  },

  getName(): string {
    return defaultDriverName;
  },

  before(callback: QueueHookCallback) {
    addHook("before", callback);
    return this;
  },
  after(callback: QueueHookCallback) {
    addHook("after", callback);
    return this;
  },
  exceptionOccurred(callback: QueueHookCallback) {
    addHook("exceptionOccurred", callback);
    return this;
  },
  failing(callback: QueueHookCallback) {
    addHook("failing", callback);
    return this;
  },
  looping(callback: QueueHookCallback) {
    addHook("looping", callback);
    return this;
  },
  starting(callback: QueueHookCallback) {
    addHook("starting", callback);
    return this;
  },
  stopping(callback: QueueHookCallback) {
    addHook("stopping", callback);
    return this;
  },

  pause(queueName = "default") {
    pausedUntil.set(queueName, Number.POSITIVE_INFINITY);
    return this;
  },

  pauseFor(seconds: number, queueName = "default") {
    pausedUntil.set(queueName, Date.now() + seconds * 1000);
    return this;
  },

  resume(queueName = "default") {
    pausedUntil.delete(queueName);
    return this;
  },

  isPaused(queueName = "default"): boolean {
    const until = pausedUntil.get(queueName);
    if (until == null) return false;
    if (until === Number.POSITIVE_INFINITY) return true;
    if (Date.now() >= until) {
      pausedUntil.delete(queueName);
      return false;
    }
    return true;
  },

  getPausedQueues(): string[] {
    return [...pausedUntil.keys()].filter((q) => this.isPaused(q));
  },

  push(
    name: string,
    data: unknown = {},
    queueName = "default",
    options?: {
      attempts?: number;
      maxTries?: number;
      id?: string;
      delay?: number;
      availableAt?: number;
      batchId?: string;
    },
  ): Promise<string> {
    return queue().push(name, data, queueName, options);
  },

  later(delay: number, job: Job): Promise<string> {
    return queue().later(delay, job);
  },

  size(queueName = "default"): Promise<number> {
    return queue().size(queueName);
  },

  work(queueName = "default", times = 1): Promise<number> {
    return queue().work(queueName, times);
  },

  retry(id: string): Promise<boolean> {
    return queue().retry(id);
  },

  retryAll(): Promise<number> {
    return queue().retryAll();
  },

  get failed() {
    return queue().failed;
  },

  fake(): QueueFake {
    previousQueue = getQueue();
    const fake = new QueueFake(previousQueue);
    setQueue(fake);
    return fake;
  },

  assertPushed(
    name: string | (new (...args: never[]) => Job),
    predicate?: PushPredicate,
  ): void {
    requireQueueFake().assertPushed(name, predicate);
  },

  assertNotPushed(name: string | (new (...args: never[]) => Job)): void {
    requireQueueFake().assertNotPushed(name);
  },

  assertPushedTimes(
    name: string | (new (...args: never[]) => Job),
    times: number,
  ): void {
    requireQueueFake().assertPushedTimes(name, times);
  },

  assertNothingPushed(): void {
    requireQueueFake().assertNothingPushed();
  },

  restore(): void {
    if (previousQueue) setQueue(previousQueue);
  },
};

export type { QueueConnectionName };
