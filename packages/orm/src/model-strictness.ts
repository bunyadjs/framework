/**
 * Model strictness + touching guards.
 * @see Model::preventSilentlyDiscardingAttributes
 * @see Model::preventAccessingMissingAttributes
 * @see Model::shouldBeStrict
 * @see Model::withoutTouching
 */

/** Depth of active eager-load work — `related()` must not trip lazy-load prevention. */
let eagerLoadDepth = 0;

export function enterEagerLoad(): void {
  eagerLoadDepth += 1;
}

export function leaveEagerLoad(): void {
  eagerLoadDepth = Math.max(0, eagerLoadDepth - 1);
}

export function isInsideEagerLoad(): boolean {
  return eagerLoadDepth > 0;
}

let preventsLazyLoading = false;
let preventsSilentlyDiscardingAttributes = false;
let preventsAccessingMissingAttributes = false;

/** Classes currently ignoring touch (empty set = ignore all when flag set). */
let ignoringTouch = false;
let ignoringTouchModels: Set<object> | null = null;

export class LazyLoadingViolationException extends Error {
  constructor(model: string, relation: string) {
    super(
      `Attempted to lazy load [${relation}] on model [${model}] but lazy loading is disabled.`,
    );
    this.name = "LazyLoadingViolationException";
  }
}

export class MassAssignmentException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MassAssignmentException";
  }
}

export class MissingAttributeException extends Error {
  constructor(model: string, key: string) {
    super(
      `The attribute [${key}] either does not exist or was not retrieved for model [${model}].`,
    );
    this.name = "MissingAttributeException";
  }
}

export function modelsShouldPreventLazyLoading(): boolean {
  return preventsLazyLoading;
}

export function modelsShouldPreventSilentlyDiscardingAttributes(): boolean {
  return preventsSilentlyDiscardingAttributes;
}

export function modelsShouldPreventAccessingMissingAttributes(): boolean {
  return preventsAccessingMissingAttributes;
}

export function preventLazyLoading(prevent = true): void {
  preventsLazyLoading = prevent;
}

export function preventSilentlyDiscardingAttributes(prevent = true): void {
  preventsSilentlyDiscardingAttributes = prevent;
}

export function preventAccessingMissingAttributes(prevent = true): void {
  preventsAccessingMissingAttributes = prevent;
}

export function shouldBeStrict(should = true): void {
  preventLazyLoading(should);
  preventSilentlyDiscardingAttributes(should);
  preventAccessingMissingAttributes(should);
}

/** Test helper — reset all strictness / touch flags. */
export function resetModelStrictnessForTests(): void {
  preventsLazyLoading = false;
  preventsSilentlyDiscardingAttributes = false;
  preventsAccessingMissingAttributes = false;
  eagerLoadDepth = 0;
  ignoringTouch = false;
  ignoringTouchModels = null;
}

export function isIgnoringTouch(modelClass?: object): boolean {
  if (!ignoringTouch) return false;
  if (!ignoringTouchModels || ignoringTouchModels.size === 0) return true;
  if (!modelClass) return true;
  return ignoringTouchModels.has(modelClass);
}

/**
 * Run without touching parent timestamps (`Model::withoutTouching`).
 * Pass model classes to limit the ignore set; omit to ignore all models.
 */
export async function withoutTouching<T>(
  modelsOrCallback: object[] | (() => T | Promise<T>),
  callback?: () => T | Promise<T>,
): Promise<T> {
  let models: object[] | null = null;
  let cb: () => T | Promise<T>;
  if (typeof modelsOrCallback === "function") {
    cb = modelsOrCallback as () => T | Promise<T>;
  } else {
    models = modelsOrCallback;
    if (!callback) {
      throw new Error("withoutTouching requires a callback.");
    }
    cb = callback;
  }

  const prevIgnoring = ignoringTouch;
  const prevModels = ignoringTouchModels;
  ignoringTouch = true;
  ignoringTouchModels =
    models && models.length > 0 ? new Set(models) : null;
  try {
    return await cb();
  } finally {
    ignoringTouch = prevIgnoring;
    ignoringTouchModels = prevModels;
  }
}
