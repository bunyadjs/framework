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

const ROUTE_NAME = Symbol.for("bunyad.controller.routeName");
const ROUTE_METHOD = Symbol.for("bunyad.controller.routeMethod");

type RouteMeta = Function & {
  [ROUTE_NAME]?: Map<string, string>;
  [ROUTE_METHOD]?: string[];
};

/** Run `apply` for a class decorator (`member` undefined) or a method decorator, legacy or stage 3. */
function onTarget(args: unknown[], apply: (ctor: RouteMeta, member: string | undefined) => void): void {
  const [target, key] = args;
  if (key !== null && typeof key === "object" && "kind" in key && "name" in key) {
    const ctx = key as { kind: string; name: string | symbol };
    if (ctx.kind === "class") return apply(target as RouteMeta, undefined);
    const ctor = typeof target === "function" ? target : (target as object).constructor;
    return apply(ctor as RouteMeta, String(ctx.name));
  }
  if (key !== undefined) return apply((target as object).constructor as RouteMeta, String(key));
  if (typeof target === "function") apply(target as RouteMeta, undefined);
}

/**
 * Name the route of a controller. On a class it names the controller's route; on a method it names
 * that action's route. Without it the name comes from the folder.
 */
export function Name(name: string): ClassDecorator & MethodDecorator {
  return ((...args: unknown[]) =>
    onTarget(args, (ctor, member) => {
      const map = ctor[ROUTE_NAME] ?? new Map<string, string>();
      map.set(member ?? "", name);
      ctor[ROUTE_NAME] = map;
    })) as ClassDecorator & MethodDecorator;
}

/**
 * Require an ability for a controller or one action: `@Can("update", "post")` is the `can:update,post`
 * middleware, which runs the Gate with the route's `{post}` model.
 */
export function Can(ability: string, ...models: string[]): ClassDecorator & MethodDecorator {
  return Middleware(`can:${[ability, ...models].join(",")}`);
}

/** HTTP verb(s) of a single-action controller (`handle`). The default is GET. */
export function Method(...verbs: string[]): ClassDecorator {
  return ((...args: unknown[]) =>
    onTarget(args, (ctor, member) => {
      if (member === undefined) ctor[ROUTE_METHOD] = verbs.map((v) => v.toUpperCase());
    })) as ClassDecorator;
}

/** Route name set by `@Name` for this action (a class-level name applies to every action). */
export function routeNameOf(Controller: Function, method: string): string | undefined {
  const map = (Controller as RouteMeta)[ROUTE_NAME];
  return map?.get(method) ?? map?.get("");
}

/** Verbs set by `@Method`, if any. */
export function routeMethodOf(Controller: Function): string[] | undefined {
  return (Controller as RouteMeta)[ROUTE_METHOD];
}

const ROUTE_SPECS = Symbol.for("bunyad.controller.routeSpecs");

/** A route declared on a controller method: a verb and a path relative to the controller's folder. */
export type DeclaredRoute = { method: string; path: string; name?: string; access?: string };

/** Options of `@Get("/x", { … })`: the route's name and its extra middleware. */
export type DeclaredRouteOptions = { name?: string; middleware?: Middleware[]; /** Who may open it: `guest` or `auth`. Replaces the access its area sets. */ access?: string };

type SpecMeta = Function & { [ROUTE_SPECS]?: Map<string, DeclaredRoute[]> };

function routeDecorator(method: string) {
  return (path = "/", options: DeclaredRouteOptions = {}): MethodDecorator =>
    ((...args: unknown[]) =>
      onTarget(args, (ctor, member) => {
        if (member === undefined) return;
        const meta = ctor as SpecMeta;
        const map = meta[ROUTE_SPECS] ?? new Map<string, DeclaredRoute[]>();
        map.set(member, [...(map.get(member) ?? []), { method, path, name: options.name, access: options.access }]);
        meta[ROUTE_SPECS] = map;
        if (options.middleware?.length) pushMethodList(ctor as unknown as Ctor, METHOD_MIDDLEWARE, member, options.middleware);
      })) as MethodDecorator;
}

/** Declare a route on a controller method. The path is relative to the controller's folder URL. */
export const Get = routeDecorator("GET");
export const Post = routeDecorator("POST");
export const Put = routeDecorator("PUT");
export const Patch = routeDecorator("PATCH");
export const Delete = routeDecorator("DELETE");

/** Routes declared with `@Get`, `@Post`, … by method name. */
export function declaredRoutesOf(Controller: Function): ReadonlyMap<string, readonly DeclaredRoute[]> {
  return (Controller as SpecMeta)[ROUTE_SPECS] ?? new Map();
}

const ROUTE_VIEW = Symbol.for("bunyad.controller.routeView");

type ViewMeta = Function & { [ROUTE_VIEW]?: Map<string, string> };

/**
 * Use a different view file for an action (or for the whole controller). The path is relative to the
 * controller's folder: `@View("../shared/FormPage.tsx")`.
 */
export function View(file: string): ClassDecorator & MethodDecorator {
  return ((...args: unknown[]) =>
    onTarget(args, (ctor, member) => {
      const meta = ctor as unknown as ViewMeta;
      const map = meta[ROUTE_VIEW] ?? new Map<string, string>();
      map.set(member ?? "", file);
      meta[ROUTE_VIEW] = map;
    })) as ClassDecorator & MethodDecorator;
}

/** View file set by `@View` for this action (a class-level one applies to every action). */
export function routeViewOf(Controller: Function, method: string): string | undefined {
  const map = (Controller as ViewMeta)[ROUTE_VIEW];
  return map?.get(method) ?? map?.get("");
}
