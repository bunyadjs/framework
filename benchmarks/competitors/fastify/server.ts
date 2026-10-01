/**
 * Fastify equivalent routes for competitor compare (Phase 5).
 *
 * Runs under Bun (same runtime as other competitor legs). Documented in
 * README — this is not a Node.js-native Fastify publish run.
 */
import Fastify from "fastify";
import {
  HELLO,
  type CompetitorServer,
} from "../shared.ts";

export async function startFastifyServer(): Promise<CompetitorServer> {
  const app = Fastify({ logger: false });

  app.get("/hello", async () => HELLO);
  app.get<{ Params: { id: string } }>("/users/:id", async (req) => ({
    id: req.params.id,
  }));
  app.get<{ Params: { userId: string; postId: string } }>(
    "/users/:userId/posts/:postId",
    async (req) => ({
      userId: req.params.userId,
      postId: req.params.postId,
    }),
  );
  app.get("/layer/router", async () => HELLO);

  // Scoped plugin: 1 onRequest hook = 1 no-op middleware for /layer/mw
  await app.register(async (scope) => {
    scope.addHook("onRequest", async () => {});
    scope.get("/layer/mw", async () => HELLO);
  });

  for (const n of [0, 1, 5, 10] as const) {
    await app.register(async (scope) => {
      for (let i = 0; i < n; i++) {
        scope.addHook("onRequest", async () => {});
      }
      scope.get(`/mw/${n}`, async () => HELLO);
    });
  }

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port =
    typeof addr === "object" && addr !== null ? addr.port : Number(addr);

  return {
    port,
    stop: async () => {
      await app.close();
    },
  };
}
