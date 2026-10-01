import type { Request, Next } from "@bunyad/http";
import { getHeadManager, runWithHead } from "./manager.ts";

/**
 * Fresh request-scoped head state for each HTTP request.
 * Place early in the global middleware stack.
 */
export function handleHead() {
  return {
    async handle(request: Request, next: Next): Promise<Response> {
      return runWithHead(() => {
        getHeadManager().setUrl(request.url);
        return next();
      }, { url: request.url });
    },
  };
}

/**
 * Share page-managed head elements on every Inertia response.
 * Call from a service provider after Inertia is available.
 */
export function shareHeadWithInertia(
  share: (
    key: string,
    value: (request: Request) => unknown | Promise<unknown>,
  ) => unknown,
): void {
  const manager = getHeadManager();
  if (!manager.inertiaEnabled()) return;
  const prop = manager.inertiaProp();
  share(prop, (request) => {
    const partial = request.header("x-inertia-partial-component");
    if (partial != null) return undefined;
    return manager.toInertia(request.url);
  });
}
