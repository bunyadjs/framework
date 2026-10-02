import type { ModelQuery } from "./model.ts";

export type GlobalScopeCallback = (query: ModelQuery) => void;

type ModelClassLike = abstract new (...args: never[]) => unknown;

const registry = new WeakMap<
  ModelClassLike,
  Map<string, GlobalScopeCallback>
>();

function scopesFor(model: ModelClassLike): Map<string, GlobalScopeCallback> {
  let map = registry.get(model);
  if (!map) {
    map = new Map();
    registry.set(model, map);
  }
  return map;
}

/** Register a named global scope on a model class. */
export function addGlobalScope(
  model: ModelClassLike,
  name: string,
  scope: GlobalScopeCallback,
): void {
  scopesFor(model).set(name, scope);
}

/** Remove a named global scope from a model class. */
export function removeGlobalScope(model: ModelClassLike, name: string): void {
  scopesFor(model).delete(name);
}

const EMPTY_SCOPES = new Map<string, GlobalScopeCallback>();

/** All registered global scopes for a model class. */
export function getGlobalScopes(
  model: ModelClassLike,
): Map<string, GlobalScopeCallback> {
  return registry.get(model) ?? EMPTY_SCOPES;
}

export function hasGlobalScopes(model: ModelClassLike): boolean {
  const map = registry.get(model);
  return map != null && map.size > 0;
}

/** Clear scopes (tests). */
export function clearGlobalScopes(model?: ModelClassLike): void {
  if (model) {
    registry.delete(model);
    return;
  }
}

type CallStaticModel = {
  newQuery(): ModelQuery;
};

/**
 * Safe ModelQuery terminals forwarded by Model `__callStatic`
 * (`Model.get()` → `Model.query().get()`).
 *
 * Allowlist only — avoid constructors, `then`, starters already owned as
 * Model statics, and arbitrary junk. Own Model / subclass statics always win
 * over this Proxy. Local `scopeFoo` still wins when present.
 *
 */
export const MODEL_STATIC_BUILDER_TERMINALS: ReadonlySet<string> = new Set([
  "get",
  "pluck",
  "value",
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "exists",
  "doesntExist",
  "first",
  "firstOrFail",
  "sole",
  "valueOrFail",
  "soleValue",
  "paginate",
  "simplePaginate",
  "cursorPaginate",
  "getSync",
  "firstSync",
  "toSql",
  "toRawSql",
  "getBindings",
]);

/**
 * `__callStatic`:
 * - Local scopes: `Model.foo()` → `Model.query().foo()` when `scopeFoo` exists
 * - Builder terminals: `Model.get()` / `pluck` / `count` / … → `Model.query()[method](…)`
 *
 * Installed as Model's [[Prototype]] so missing static lookups on subclasses
 * (e.g. `Shop.active`, `User.get`) reach this trap before `Function.prototype`.
 */
export function installLocalScopeCallStatic(ModelCtor: CallStaticModel): void {
  const parent = Object.getPrototypeOf(ModelCtor) as object;
  if (
    parent &&
    (parent as { __bunyadLocalScopeCallStatic?: boolean })
      .__bunyadLocalScopeCallStatic
  ) {
    return;
  }

  const trap = new Proxy(parent, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") {
        return Reflect.get(target, prop, receiver);
      }
      if (
        typeof prop === "string" &&
        prop.length > 0 &&
        !prop.startsWith("scope") &&
        prop !== "prototype" &&
        prop !== "name" &&
        prop !== "length"
      ) {
        const scopeName = `scope${prop.charAt(0).toUpperCase()}${prop.slice(1)}`;
        const scopeFn = (receiver as Record<string, unknown>)[scopeName];
        if (typeof scopeFn === "function") {
          return (...args: unknown[]) => {
            const q = (receiver as CallStaticModel).newQuery();
            const onQuery = (q as unknown as Record<string, unknown>)[prop];
            if (typeof onQuery === "function") {
              return (onQuery as (...a: unknown[]) => unknown).apply(q, args);
            }
            (scopeFn as (query: ModelQuery, ...a: unknown[]) => void).call(
              receiver,
              q,
              ...args,
            );
            return q;
          };
        }

        if (MODEL_STATIC_BUILDER_TERMINALS.has(prop)) {
          return (...args: unknown[]) => {
            const q = (receiver as CallStaticModel).newQuery();
            const fn = (q as unknown as Record<string, unknown>)[prop];
            if (typeof fn !== "function") {
              throw new TypeError(
                `${(receiver as { name?: string }).name ?? "Model"}.${prop} is not available on the query builder.`,
              );
            }
            return (fn as (...a: unknown[]) => unknown).apply(q, args);
          };
        }
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  Object.defineProperty(trap, "__bunyadLocalScopeCallStatic", {
    value: true,
    enumerable: false,
    configurable: false,
  });

  Object.setPrototypeOf(ModelCtor, trap);
}
