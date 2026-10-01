import type { Middleware } from "./pipeline.ts";
import {
  middlewareAliasOf,
  parseMiddlewareName,
  resolveMiddlewareStack,
} from "./middleware-alias.ts";

const CLASS_MIDDLEWARE = Symbol.for("bunyad.controller.middleware");
const CLASS_WITHOUT = Symbol.for("bunyad.controller.withoutMiddleware");
const METHOD_MIDDLEWARE = Symbol.for("bunyad.controller.methodMiddleware");
const METHOD_WITHOUT = Symbol.for("bunyad.controller.methodWithoutMiddleware");

type Ctor = Function & {
  [CLASS_MIDDLEWARE]?: Middleware[];
  [CLASS_WITHOUT]?: string[];
  [METHOD_MIDDLEWARE]?: Map<string | symbol, Middleware[]>;
  [METHOD_WITHOUT]?: Map<string | symbol, string[]>;
};

function pushClassList(
  target: Ctor,
  key: typeof CLASS_MIDDLEWARE | typeof CLASS_WITHOUT,
  values: unknown[],
): void {
  if (key === CLASS_MIDDLEWARE) {
    target[CLASS_MIDDLEWARE] = [
      ...(target[CLASS_MIDDLEWARE] ?? []),
      ...(values as Middleware[]),
    ];
    return;
  }
  target[CLASS_WITHOUT] = [
    ...(target[CLASS_WITHOUT] ?? []),
    ...(values as string[]),
  ];
}

function pushMethodList(
  ctor: Ctor,
  mapKey: typeof METHOD_MIDDLEWARE | typeof METHOD_WITHOUT,
  propertyKey: string | symbol,
  values: unknown[],
): void {
  if (mapKey === METHOD_MIDDLEWARE) {
    const map = ctor[METHOD_MIDDLEWARE] ?? new Map<string | symbol, Middleware[]>();
    const existing = map.get(propertyKey) ?? [];
    map.set(propertyKey, [...existing, ...(values as Middleware[])]);
    ctor[METHOD_MIDDLEWARE] = map;
    return;
  }
  const map = ctor[METHOD_WITHOUT] ?? new Map<string | symbol, string[]>();
  const existing = map.get(propertyKey) ?? [];
  map.set(propertyKey, [...existing, ...(values as string[])]);
  ctor[METHOD_WITHOUT] = map;
}

/**
 * Attach middleware to a controller class or action method.
 * Merged by the HTTP kernel after route middleware.
 */
export function Middleware(
  ...middleware: Middleware[]
): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol) => {
    // Stage 3: (value, context) with context.kind / context.name
    if (
      propertyKey !== undefined &&
      propertyKey !== null &&
      typeof propertyKey === "object" &&
      "kind" in (propertyKey as object) &&
      "name" in (propertyKey as object)
    ) {
      const ctx = propertyKey as { kind: string; name: string | symbol };
      if (ctx.kind === "class") {
        pushClassList(target as Ctor, CLASS_MIDDLEWARE, middleware);
        return;
      }
      const ctor =
        typeof target === "function"
          ? (target as Ctor)
          : (target.constructor as Ctor);
      pushMethodList(ctor, METHOD_MIDDLEWARE, ctx.name, middleware);
      return;
    }

    if (propertyKey !== undefined) {
      pushMethodList(
        target.constructor as Ctor,
        METHOD_MIDDLEWARE,
        propertyKey,
        middleware,
      );
      return;
    }

    // Class decorator receives the constructor. Bun sometimes invokes method
    // decorators with only the prototype — ignore that (no method name).
    if (typeof target !== "function") {
      return;
    }
    pushClassList(target as Ctor, CLASS_MIDDLEWARE, middleware);
  }) as ClassDecorator & MethodDecorator;
}

/**
 * Exclude named middleware aliases from the stack for a class or method.
 * Names match aliases (`auth`, `throttle`, `auth:token`).
 */
export function WithoutMiddleware(
  ...names: string[]
): ClassDecorator & MethodDecorator {
  return ((target: object, propertyKey?: string | symbol) => {
    if (
      propertyKey !== undefined &&
      propertyKey !== null &&
      typeof propertyKey === "object" &&
      "kind" in (propertyKey as object) &&
      "name" in (propertyKey as object)
    ) {
      const ctx = propertyKey as { kind: string; name: string | symbol };
      if (ctx.kind === "class") {
        pushClassList(target as Ctor, CLASS_WITHOUT, names);
        return;
      }
      const ctor =
        typeof target === "function"
          ? (target as Ctor)
          : (target.constructor as Ctor);
      pushMethodList(ctor, METHOD_WITHOUT, ctx.name, names);
      return;
    }

    if (propertyKey !== undefined) {
      pushMethodList(
        target.constructor as Ctor,
        METHOD_WITHOUT,
        propertyKey,
        names,
      );
      return;
    }

    if (typeof target !== "function") {
      return;
    }
    pushClassList(target as Ctor, CLASS_WITHOUT, names);
  }) as ClassDecorator & MethodDecorator;
}

/** Middleware declared on the controller class + action method. */
export function controllerMiddlewareOf(
  Controller: Function,
  method: string,
): Middleware[] {
  const ctor = Controller as Ctor;
  const classMw = ctor[CLASS_MIDDLEWARE] ?? [];
  const methodMw = ctor[METHOD_MIDDLEWARE]?.get(method) ?? [];
  return resolveMiddlewareStack([...classMw, ...methodMw]);
}

/** Alias names to strip from the resolved middleware stack. */
export function withoutMiddlewareOf(
  Controller: Function,
  method: string,
): string[] {
  const ctor = Controller as Ctor;
  const classWithout = ctor[CLASS_WITHOUT] ?? [];
  const methodWithout = ctor[METHOD_WITHOUT]?.get(method) ?? [];
  return [...classWithout, ...methodWithout];
}

function aliasMatches(entry: Middleware, without: string): boolean {
  const alias = middlewareAliasOf(entry);
  if (!alias) return false;
  if (alias === without) return true;
  const entryBase = parseMiddlewareName(alias).name;
  const withoutBase = parseMiddlewareName(without).name;
  return entryBase === without || entryBase === withoutBase;
}

/** Drop middleware whose alias is listed in `without`. */
export function excludeMiddleware(
  stack: Middleware[],
  without: string[],
): Middleware[] {
  if (without.length === 0) return stack;
  return stack.filter(
    (entry) => !without.some((name) => aliasMatches(entry, name)),
  );
}

/**
 * Build the full middleware stack for a controller action:
 * route middleware + controller/method middleware, minus WithoutMiddleware.
 */
export function mergeControllerMiddleware(
  routeMiddleware: Middleware[],
  Controller: Function,
  method: string,
): Middleware[] {
  const combined = [
    ...routeMiddleware,
    ...controllerMiddlewareOf(Controller, method),
  ];
  return excludeMiddleware(combined, withoutMiddlewareOf(Controller, method));
}
