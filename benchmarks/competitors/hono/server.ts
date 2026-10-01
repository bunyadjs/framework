/**
 * Hono equivalent routes for competitor compare (Phase 5).
 */
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  HELLO,
  type CompetitorServer,
} from "../shared.ts";

const noop: MiddlewareHandler = async (_c, next) => {
  await next();
};

function stack(n: number): MiddlewareHandler[] {
  return Array.from({ length: n }, () => noop);
}

export function startHonoServer(): CompetitorServer {
  const app = new Hono();

  app.get("/hello", (c) => c.json(HELLO));
  app.get("/users/:id", (c) => c.json({ id: c.req.param("id") }));
  app.get("/users/:userId/posts/:postId", (c) =>
    c.json({
      userId: c.req.param("userId"),
      postId: c.req.param("postId"),
    }),
  );
  app.get("/layer/router", (c) => c.json(HELLO));
  app.get("/layer/mw", noop, (c) => c.json(HELLO));
  app.get("/mw/0", (c) => c.json(HELLO));
  app.get("/mw/1", ...stack(1), (c) => c.json(HELLO));
  app.get("/mw/5", ...stack(5), (c) => c.json(HELLO));
  app.get("/mw/10", ...stack(10), (c) => c.json(HELLO));

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: app.fetch,
  });

  return {
    port: server.port,
    stop: () => {
      server.stop(true);
    },
  };
}
