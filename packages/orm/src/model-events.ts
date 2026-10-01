import type { Model } from "./model.ts";

/** Eloquent model lifecycle event names. */
export type ModelEventName =
  | "retrieved"
  | "creating"
  | "created"
  | "updating"
  | "updated"
  | "saving"
  | "saved"
  | "deleting"
  | "deleted"
  | "trashed"
  | "forceDeleting"
  | "forceDeleted"
  | "restoring"
  | "restored"
  | "replicating";

export const MODEL_EVENT_NAMES: readonly ModelEventName[] = [
  "retrieved",
  "creating",
  "created",
  "updating",
  "updated",
  "saving",
  "saved",
  "deleting",
  "deleted",
  "trashed",
  "forceDeleting",
  "forceDeleted",
  "restoring",
  "restored",
  "replicating",
] as const;

/**
 * Listener for a model event.
 * Return `false` from a before-event (`creating`, `saving`, …) to cancel.
 */
export type ModelEventListener<T extends Model = Model> = (
  model: T,
) => void | boolean | Promise<void | boolean>;

/** Observer object with optional methods named after events. */
export type ModelObserver<T extends Model = Model> = {
  [K in ModelEventName]?: (model: T) => void | boolean | Promise<void | boolean>;
};

type ModelCtor = abstract new (...args: never[]) => Model;

type ListenerEntry = {
  listener: ModelEventListener;
};

const booted = new WeakSet<ModelCtor>();
const listeners = new WeakMap<ModelCtor, Map<ModelEventName, ListenerEntry[]>>();
const eventsDisabled = new WeakMap<ModelCtor, number>();

function listenerMap(ctor: ModelCtor): Map<ModelEventName, ListenerEntry[]> {
  let map = listeners.get(ctor);
  if (!map) {
    map = new Map();
    listeners.set(ctor, map);
  }
  return map;
}

/** Whether events are currently suppressed for this model class. */
export function modelEventsDisabled(ctor: ModelCtor): boolean {
  return (eventsDisabled.get(ctor) ?? 0) > 0;
}

/**
 * Ensure `boot` / `booted` have run once for this model class.
 * Call sites: first query, save, or `static::created(...)` registration.
 */
export function bootIfNotBooted(ctor: ModelCtor & {
  boot?: () => void;
  booted?: () => void;
}): void {
  if (booted.has(ctor)) return;
  booted.add(ctor);
  ctor.boot?.();
  ctor.booted?.();
}

/** Register a listener for a model event on this class. */
export function registerModelEvent(
  ctor: ModelCtor,
  event: ModelEventName,
  listener: ModelEventListener,
): void {
  bootIfNotBooted(ctor as ModelCtor & { boot?: () => void; booted?: () => void });
  const map = listenerMap(ctor);
  const list = map.get(event) ?? [];
  list.push({ listener });
  map.set(event, list);
}

/**
 * Fire a model event. Returns `false` if a listener cancelled the operation.
 * After-events (`created`, `saved`, …) ignore `false` return values for control flow
 * but still run all listeners.
 * No-listener path is synchronous so SQLite save/find skip Promise microtasks.
 */
export function fireModelEvent(
  model: Model,
  event: ModelEventName,
): boolean | Promise<boolean> {
  const ctor = model.constructor as ModelCtor;
  if (modelEventsDisabled(ctor)) return true;

  const list = listeners.get(ctor)?.get(event);
  if (!list || list.length === 0) return true;

  return fireModelEventList(model, event, list);
}

async function fireModelEventList(
  model: Model,
  event: ModelEventName,
  list: ListenerEntry[],
): Promise<boolean> {
  const isBefore = event.endsWith("ing") && event !== "replicating";

  for (const entry of list) {
    const result = await entry.listener(model);
    if (isBefore && result === false) return false;
  }
  return true;
}

/** True when at least one listener is registered for this event. */
export function hasModelEventListeners(
  ctor: ModelCtor,
  event: ModelEventName,
): boolean {
  if (modelEventsDisabled(ctor)) return false;
  const list = listeners.get(ctor)?.get(event);
  return Boolean(list && list.length > 0);
}

export function hasAnyModelEventListeners(ctor: ModelCtor): boolean {
  if (modelEventsDisabled(ctor)) return false;
  const map = listeners.get(ctor);
  if (!map) return false;
  for (const list of map.values()) {
    if (list.length > 0) return true;
  }
  return false;
}

/** Run `callback` with model events disabled for `ctor`. */
export function withoutModelEvents<T>(
  ctor: ModelCtor,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  eventsDisabled.set(ctor, (eventsDisabled.get(ctor) ?? 0) + 1);
  const finish = () => {
    const depth = (eventsDisabled.get(ctor) ?? 1) - 1;
    if (depth <= 0) eventsDisabled.delete(ctor);
    else eventsDisabled.set(ctor, depth);
  };
  try {
    const result = callback();
    if (result instanceof Promise) {
      return result.finally(finish);
    }
    finish();
    return result;
  } catch (error) {
    finish();
    throw error;
  }
}

/** Register an observer instance or class (Laravel `Model::observe`). */
export function observeModel<T extends Model>(
  ctor: abstract new (...args: never[]) => T,
  observer:
    | ModelObserver<T>
    | (new () => ModelObserver<T>)
    | Array<ModelObserver<T> | (new () => ModelObserver<T>)>,
): void {
  const list = Array.isArray(observer) ? observer : [observer];
  for (const item of list) {
    const instance =
      typeof item === "function"
        ? new (item as new () => ModelObserver<T>)()
        : item;
    for (const event of MODEL_EVENT_NAMES) {
      const method = instance[event];
      if (typeof method === "function") {
        registerModelEvent(ctor, event, (model) =>
          method.call(instance, model as T),
        );
      }
    }
  }
}

/** Test helper — clear boot state and listeners for a model class. */
export function resetModelEventsForTests(ctor: ModelCtor): void {
  booted.delete(ctor);
  listeners.delete(ctor);
  eventsDisabled.delete(ctor);
}
