/**
 * Bunyad as an app: file routes (`bunyad-app/routes`), booted with `bunyad(import.meta)`, served through the
 * HTTP kernel. The same routes and payloads as the other servers; `bunyad-ref.ts` is the bare router.
 */
import { createFetchHandler } from "../../packages/core/src/index.ts";
import type { CompetitorServer } from "./shared.ts";
import { createApplication } from "./bunyad-app/server.ts";

export async function startBunyadAppServer(): Promise<CompetitorServer> {
  const app = await createApplication();
  const handle = createFetchHandler(app);
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => handle(request) });
  return { port: server.port, stop: () => void server.stop(true) };
}
