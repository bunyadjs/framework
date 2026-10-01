/**
 * Bunyad reference server — same routes/payloads as competitor servers.
 * Used only for side-by-side fairness in Phase 5 (does not optimise Bunyad).
 */
import {
  Application,
  createFetchHandler,
} from "../../packages/core/src/index.ts";
import { json, type Middleware } from "../../packages/http/src/index.ts";
import { Router } from "../../packages/router/src/index.ts";
import {
  HELLO,
  type CompetitorServer,
} from "./shared.ts";

const noopMw: Middleware = (_request, next) => next();

function makeNoopStack(n: number): Middleware[] {
  return Array.from({ length: n }, () => noopMw);
}

export async function startBunyadRefServer(): Promise<CompetitorServer> {
  const router = new Router();

  router.get("/hello", () => json(HELLO));
  router.get("/users/{id}", (req) => json({ id: req.route("id") }));
  router.get("/users/{userId}/posts/{postId}", (req) =>
    json({
      userId: req.route("userId"),
      postId: req.route("postId"),
    }),
  );
  router.get("/layer/router", () => json(HELLO));
  router.get("/layer/mw", () => json(HELLO)).middleware(...makeNoopStack(1));

  for (const n of [0, 1, 5, 10] as const) {
    const reg = router.get(`/mw/${n}`, () => json(HELLO));
    if (n > 0) reg.middleware(...makeNoopStack(n));
  }

  const app = new Application({
    router,
    config: { app: { port: 0 } },
  });
  await app.boot();
  const handle = createFetchHandler(app);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => handle(request),
  });

  return {
    port: server.port,
    stop: () => {
      server.stop(true);
    },
  };
}
