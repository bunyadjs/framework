import type { Request, Next, Middleware } from "@bunyad/http";
import { Cache } from "@bunyad/cache";

/**
 * Opt-in concurrent session lock. While held, other requests sharing the same
 * session id wait (or time out) before continuing.
 *
 * Defaults: hold up to 10s, wait up to 10s. Uses `Cache.lock`.
 */
export function blockSession(
  lockSeconds = 10,
  waitSeconds = 10,
): Middleware {
  return {
    async handle(request: Request, next: Next) {
      const session = request.session;
      if (!session) return next();

      const id = session.id?.();
      if (!id) return next();

      const lock = Cache.lock(`session:${id}`, lockSeconds);
      await lock.block(waitSeconds);
      try {
        return await next();
      } finally {
        await lock.release();
      }
    },
  };
}

/** Facade-style alias: `Session.block(10, 10)`. */
export const SessionBlock = {
  block: blockSession,
};
