import type { Job } from "./job.ts";

export type QueueRouteTarget = {
  /** Queue connection name. */
  connection?: string | null;
  /** Queue name. */
  queue?: string | null;
};

type RouteKey = string | Function;

/**
 * Queue routes — default connection/queue by class,
 * parent, or marker (interface/trait stand-in as a constructor).
 */
export class QueueRoutes {
  readonly #routes = new Map<RouteKey, QueueRouteTarget | string>();

  /**
   * Register routes.
   *
   * ```ts
   * routes.set(ProcessPodcast, "podcasts");
   * routes.set(ProcessPodcast, "podcasts", "redis");
   * routes.set(ProcessPodcast, { queue: "podcasts", connection: "redis" });
   * routes.set([[ProcessPodcast, { queue: "podcasts", connection: "redis" }]]);
   * ```
   */
  set(
    classOrMap:
      | RouteKey
      | Array<[RouteKey, string | [string | null, string | null] | QueueRouteTarget]>
      | Record<string, string | [string | null, string | null] | QueueRouteTarget>,
    queue?: string | null | QueueRouteTarget,
    connection?: string | null,
  ): void {
    if (Array.isArray(classOrMap)) {
      for (const [from, to] of classOrMap) {
        this.#routes.set(from, normalizeTarget(to));
      }
      return;
    }

    if (
      classOrMap !== null &&
      typeof classOrMap === "object" &&
      typeof classOrMap !== "function"
    ) {
      for (const [from, to] of Object.entries(classOrMap)) {
        this.#routes.set(from, normalizeTarget(to));
      }
      return;
    }

    if (queue !== undefined && typeof queue === "object" && queue !== null && !Array.isArray(queue)) {
      this.#routes.set(classOrMap as RouteKey, {
        connection: queue.connection ?? null,
        queue: queue.queue ?? null,
      });
      return;
    }

    // PHP: route($class, $queue = null, $connection = null)
    this.#routes.set(classOrMap as RouteKey, {
      connection: connection ?? null,
      queue: (queue as string | null | undefined) ?? null,
    });
  }

  getRoute(queueable: object): QueueRouteTarget | string | null {
    if (this.#routes.size === 0) return null;

    for (const key of classKeysFor(queueable)) {
      const hit = this.#routes.get(key);
      if (hit !== undefined) return hit;
    }
    return null;
  }

  getConnection(queueable: object): string | null {
    const route = this.getRoute(queueable);
    if (route == null) return null;
    if (typeof route === "string") return null;
    return route.connection ?? null;
  }

  getQueue(queueable: object): string | null {
    const route = this.getRoute(queueable);
    if (route == null) return null;
    if (typeof route === "string") return route;
    return route.queue ?? null;
  }

  all(): Map<RouteKey, QueueRouteTarget | string> {
    return new Map(this.#routes);
  }

  clear(): void {
    this.#routes.clear();
  }
}

function normalizeTarget(
  to: string | [string | null, string | null] | QueueRouteTarget,
): string | QueueRouteTarget {
  if (typeof to === "string") return to;
  if (Array.isArray(to)) {
    // Match PHP single-class storage: [connection, queue]
    return { connection: to[0] ?? null, queue: to[1] ?? null };
  }
  return {
    connection: to.connection ?? null,
    queue: to.queue ?? null,
  };
}

/** Exact class → parents → marker keys (constructor names + functions). */
function classKeysFor(queueable: object): RouteKey[] {
  const keys: RouteKey[] = [];
  const seen = new Set<RouteKey>();

  const add = (key: RouteKey | null | undefined) => {
    if (key == null || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
    if (typeof key === "function" && key.name) {
      if (!seen.has(key.name)) {
        seen.add(key.name);
        keys.push(key.name);
      }
    }
  };

  add(queueable.constructor as Function);

  let proto = Object.getPrototypeOf(queueable);
  while (proto && proto !== Object.prototype) {
    const ctor = proto.constructor as Function | undefined;
    if (ctor && ctor !== Object) add(ctor);
    proto = Object.getPrototypeOf(proto);
  }

  // Marker interfaces/traits: empty classes listed on the instance or ctor.
  const markers =
    (queueable as { queueRouteMarkers?: RouteKey[] }).queueRouteMarkers ??
    (queueable.constructor as { queueRouteMarkers?: RouteKey[] }).queueRouteMarkers;
  if (Array.isArray(markers)) {
    for (const m of markers) add(m);
  }

  // `instanceof` markers registered as functions — check all route keys later via resolve
  return keys;
}

/**
 * Also match route keys where `queueable instanceof Key` (marker base classes).
 */
export function resolveRouteFor(
  routes: QueueRoutes,
  queueable: object,
): QueueRouteTarget | string | null {
  const direct = routes.getRoute(queueable);
  if (direct != null) return direct;

  for (const [key, target] of routes.all()) {
    if (typeof key !== "function") continue;
    try {
      if (queueable instanceof key) return target;
    } catch {
      /* non-constructible */
    }
  }
  return null;
}

/** Apply routed connection/queue onto a job when not explicitly set. */
export function applyQueueRoute(job: Job, routes: QueueRoutes): void {
  const route = resolveRouteFor(routes, job);
  if (route == null) return;

  const connection = typeof route === "string" ? null : route.connection;
  const queue = typeof route === "string" ? route : route.queue;

  if (
    queue != null &&
    !jobHasExplicitQueue(job) &&
    (job.queue === "default" || job.queue == null || job.queue === "")
  ) {
    job.queue = queue;
  }

  if (connection != null && !jobHasExplicitConnection(job) && job.connection == null) {
    job.connection = connection;
  }
}

const explicitQueue = new WeakSet<object>();
const explicitConnection = new WeakSet<object>();

export function markExplicitQueue(job: object): void {
  explicitQueue.add(job);
}

export function markExplicitConnection(job: object): void {
  explicitConnection.add(job);
}

export function jobHasExplicitQueue(job: object): boolean {
  return explicitQueue.has(job);
}

export function jobHasExplicitConnection(job: object): boolean {
  return explicitConnection.has(job);
}

/** Process-wide routes. */
const globalRoutes = new QueueRoutes();

export function queueRoutes(): QueueRoutes {
  return globalRoutes;
}

export function clearQueueRoutes(): void {
  globalRoutes.clear();
}
