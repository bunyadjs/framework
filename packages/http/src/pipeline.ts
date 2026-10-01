import type { Request } from "./request.ts";

/**
 * Continue the pipeline. Pass a request to replace the one seen by later layers.
 * `next()` keeps the current request.
 */
export type Next = (request?: Request) => Promise<Response> | Response;

export type MiddlewareHandler = (
  request: Request,
  next: Next,
  ...params: string[]
) => Response | Promise<Response>;

export type Terminable = {
  terminate?: (
    request: Request,
    response: Response,
  ) => void | Promise<void>;
};

/** Route middleware — object, function, or alias string (`auth`, `throttle:api`). */
export type Middleware =
  | string
  | MiddlewareHandler
  | ({ handle: MiddlewareHandler; alias?: string; __params?: string[] } &
      Terminable);

function paramsOf(layer: Middleware): string[] {
  if (typeof layer === "string") return [];
  if (typeof layer === "function") return [];
  return layer.__params ?? [];
}

function isTerminable(
  layer: Middleware,
): layer is Extract<Middleware, { handle: MiddlewareHandler }> & Terminable {
  return (
    typeof layer === "object" &&
    layer !== null &&
    typeof (layer as Terminable).terminate === "function"
  );
}

function thenResponse(
  result: Response | Promise<Response>,
  after: (response: Response) => Response | Promise<Response>,
): Response | Promise<Response> {
  if (result instanceof Promise || typeof (result as unknown as PromiseLike<Response>).then === "function") {
    return Promise.resolve(result).then(after);
  }
  return after(result as Response);
}

/**
 * Run middleware left-to-right, then the destination.
 * String aliases must be resolved first (`resolveMiddlewareStack`).
 * After the response is produced, `terminate` runs on layers that define it (outer-first).
 */
export function runPipeline(
  request: Request,
  stack: Middleware[],
  destination: (request: Request) => Response | Promise<Response>,
): Response | Promise<Response> {
  let current = request;
  const terminables: Array<{
    layer: Extract<Middleware, { handle: MiddlewareHandler }> & Terminable;
    request: Request;
  }> = [];

  let index = -1;

  const dispatch = (i: number): Response | Promise<Response> => {
    if (i <= index) {
      throw new Error("next() called multiple times");
    }
    index = i;
    if (i === stack.length) {
      return destination(current);
    }
    const layer = stack[i]!;
    if (typeof layer === "string") {
      throw new Error(
        `Unresolved middleware alias [${layer}]. Call resolveMiddlewareStack() first.`,
      );
    }
    const captured = current;
    if (isTerminable(layer)) {
      terminables.push({ layer, request: captured });
    }
    const next: Next = (replaced?) => {
      if (replaced !== undefined) current = replaced;
      return dispatch(i + 1);
    };
    const params = paramsOf(layer);
    if (typeof layer === "function") {
      return layer(captured, next, ...params);
    }
    return layer.handle(captured, next, ...params);
  };

  const result = stack.length === 0 ? destination(current) : dispatch(0);

  if (terminables.length === 0) return result;

  return thenResponse(result, async (response) => {
    for (let i = terminables.length - 1; i >= 0; i--) {
      const entry = terminables[i]!;
      await entry.layer.terminate?.(entry.request, response);
    }
    return response;
  });
}
