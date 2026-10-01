import type { Middleware } from "./pipeline.ts";
import {
  middlewareAliasOf,
  resolveMiddlewareStack,
} from "./middleware-alias.ts";

const CLASS_MIDDLEWARE = Symbol.for("bunyad.controller.middleware");
const METHOD_MIDDLEWARE = Symbol.for("bunyad.controller.methodMiddleware");
const METHOD_WITHOUT = Symbol.for("bunyad.controller.methodWithoutMiddleware");

type Ctor = Function & {
  [CLASS_MIDDLEWARE]?: Middleware[];
  [METHOD_MIDDLEWARE]?: Map<string | symbol, Middleware[]>;
  [METHOD_WITHOUT]?: Map<string | symbol, string[]>;
};

function pushClassMiddleware(ctor: Ctor, values: Middleware[]): void {
  ctor[CLASS_MIDDLEWARE] = [...(ctor[CLASS_MIDDLEWARE] ?? []), ...values];
}

function pushMethodMiddleware(
  ctor: Ctor,
  method: string,
  values: Middleware[],
): void {
  const map =
    ctor[METHOD_MIDDLEWARE] ?? new Map<string | symbol, Middleware[]>();
  map.set(method, [...(map.get(method) ?? []), ...values]);
  ctor[METHOD_MIDDLEWARE] = map;
}

function pushMethodWithout(
  ctor: Ctor,
  method: string,
  names: string[],
): void {
  const map = ctor[METHOD_WITHOUT] ?? new Map<string | symbol, string[]>();
  map.set(method, [...(map.get(method) ?? []), ...names]);
  ctor[METHOD_WITHOUT] = map;
}

function aliasNames(entries: Array<string | Middleware>): string[] {
  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      names.push(entry);
      continue;
    }
    const alias = middlewareAliasOf(entry);
    if (alias) names.push(alias);
  }
  return names;
}

export type ControllerMiddlewareBuilder = {
  /** Apply middleware only to these action methods. */
  only(...methods: string[]): void;
  /** Apply middleware to every action except these methods. */
  except(...methods: string[]): void;
};

/**
 * Optional base class for controllers that register middleware in the
 * constructor: `this.middleware("auth").only("index")`.
 */
export class Controller {
  /**
   * Register middleware for this controller.
   * With no further call, applies to every action. Chain `only` / `except`
   * to narrow the set of methods.
   */
  protected middleware(
    ...entries: Array<string | Middleware>
  ): ControllerMiddlewareBuilder {
    const ctor = this.constructor as Ctor;
    const resolved = resolveMiddlewareStack(entries);
    const names = aliasNames(entries);

    pushClassMiddleware(ctor, resolved);

    return {
      only: (...methods: string[]) => {
        const list = ctor[CLASS_MIDDLEWARE] ?? [];
        ctor[CLASS_MIDDLEWARE] = list.slice(
          0,
          Math.max(0, list.length - resolved.length),
        );
        for (const method of methods) {
          pushMethodMiddleware(ctor, method, resolved);
        }
      },
      except: (...methods: string[]) => {
        const without = names.length > 0 ? names : aliasNames(resolved);
        for (const method of methods) {
          pushMethodWithout(ctor, method, without);
        }
      },
    };
  }
}
