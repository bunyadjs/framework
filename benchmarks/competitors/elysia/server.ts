/**
 * Elysia equivalent routes for competitor compare (Phase 5).
 *
 * Note: Elysia's router forbids different param names at the same path
 * segment, so nested uses `/users/:id/posts/:postId` but still returns
 * `{ userId, postId }` — identical payload to Bunyad / Hono / Fastify.
 */
import { Elysia } from "elysia";
import {
  HELLO,
  type CompetitorServer,
} from "../shared.ts";

function noop(): void {}

export function startElysiaServer(): CompetitorServer {
  const app = new Elysia()
    .get("/hello", () => HELLO)
    .get("/users/:id", ({ params }) => ({ id: params.id }))
    .get("/users/:id/posts/:postId", ({ params }) => ({
      userId: params.id,
      postId: params.postId,
    }))
    .get("/layer/router", () => HELLO)
    .get("/layer/mw", () => HELLO, { beforeHandle: noop })
    .get("/mw/0", () => HELLO)
    .get("/mw/1", () => HELLO, { beforeHandle: noop })
    .get("/mw/5", () => HELLO, {
      beforeHandle: [noop, noop, noop, noop, noop],
    })
    .get("/mw/10", () => HELLO, {
      beforeHandle: [
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
        noop,
      ],
    });

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
