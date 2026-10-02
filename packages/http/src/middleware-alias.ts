import type { Middleware, MiddlewareHandler } from "./pipeline.ts";

export type MiddlewareFactory = (...params: string[]) => Middleware;

const aliases = new Map<string, MiddlewareFactory>();

/** `aliasMiddleware` — register a named middleware factory. */
export function aliasMiddleware(name: string, factory: MiddlewareFactory): void {
  aliases.set(name, factory);
}

export function getMiddlewareAlias(name: string): MiddlewareFactory | undefined {
  return aliases.get(name);
}

/** Parse `auth:token` / `can:update,post` / `throttle:api`. */
export function parseMiddlewareName(raw: string): {
  name: string;
  params: string[];
} {
  const idx = raw.indexOf(":");
  if (idx === -1) return { name: raw, params: [] };
  return {
    name: raw.slice(0, idx),
    params: raw.slice(idx + 1).split(",").filter(Boolean),
  };
}

/**
 * Resolve string middleware names to handlers.
 * Alias params (`role:editor`) are passed to the factory and attached so
 * `handle(request, next, ...params)` receives them in the pipeline.
 */
export function resolveMiddleware(entry: string | Middleware): Middleware {
  if (typeof entry !== "string") return entry;
  const { name, params } = parseMiddlewareName(entry);
  const factory = aliases.get(name);
  if (!factory) {
    throw new Error(
      `Middleware [${entry}] is not defined. Register it with aliasMiddleware().`,
    );
  }
  const resolved = factory(...params);
  if (params.length === 0) {
    return typeof resolved === "string"
      ? resolved
      : taggedMiddleware(entry, resolved as Exclude<Middleware, string>);
  }
  if (typeof resolved === "function") {
    const fn: MiddlewareHandler = (request, next, ...rest) =>
      resolved(request, next, ...(rest.length > 0 ? rest : params));
    return Object.assign(fn, { alias: entry, __params: params });
  }
  if (typeof resolved === "object" && resolved !== null && "handle" in resolved) {
    return taggedMiddleware(entry, {
      ...resolved,
      __params: params,
      handle: (request, next, ...rest) =>
        resolved.handle(
          request,
          next,
          ...(rest.length > 0 ? rest : params),
        ),
    });
  }
  return resolved;
}

export function resolveMiddlewareStack(
  stack: Array<string | Middleware>,
): Middleware[] {
  return stack.map(resolveMiddleware);
}

/**
 * Expand middleware group names (`web`, `api`) before alias resolution.
 * Nested groups are expanded recursively; unknown names stay as aliases.
 */
export function expandMiddlewareGroups(
  stack: Array<string | Middleware>,
  resolveGroup: (name: string) => Array<string | Middleware> | undefined,
): Array<string | Middleware> {
  const out: Array<string | Middleware> = [];
  for (const entry of stack) {
    if (typeof entry === "string") {
      const { name } = parseMiddlewareName(entry);
      const group = resolveGroup(name);
      if (group) {
        out.push(...expandMiddlewareGroups(group, resolveGroup));
        continue;
      }
    }
    out.push(entry);
  }
  return out;
}

/** Tag a middleware instance with its alias for the compiler. */
export function taggedMiddleware<T extends Middleware>(
  alias: string,
  middleware: T,
): T & { alias: string } {
  return Object.assign(middleware, { alias });
}

export function middlewareAliasOf(
  middleware: string | Middleware,
): string | undefined {
  if (typeof middleware === "string") return middleware;
  if (
    middleware &&
    typeof middleware === "object" &&
    "alias" in middleware &&
    typeof (middleware as { alias?: unknown }).alias === "string"
  ) {
    return (middleware as { alias: string }).alias;
  }
  return undefined;
}

/**
 * Reorder a middleware stack so aliases that appear in `priority` run in that
 * order relative to each other. Entries not listed keep their relative order.
 */
export function sortMiddlewareByPriority(
  stack: Array<string | Middleware>,
  priority: readonly string[],
): Array<string | Middleware> {
  if (priority.length === 0 || stack.length <= 1) return stack;
  const rank = new Map(priority.map((name, i) => [name, i]));
  return [...stack]
    .map((entry, index) => {
      const raw = middlewareAliasOf(entry);
      const name = raw?.includes(":") ? raw.slice(0, raw.indexOf(":")) : raw;
      const listed = name != null && rank.has(name) ? rank.get(name)! : -1;
      return {
        entry,
        index,
        rank: listed === -1 ? priority.length + index : listed,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.entry);
}
