import createServer from "@inertiajs/react/server";
import { renderInertiaPage } from "../../bootstrap/inertia-ssr.tsx";

/**
 * Optional HTTP SSR worker (`bunyad inertia:start-ssr`).
 * Prefer in-process `Inertia.ssr({ mode: "inline", render })` on Bun.
 */
const port = Number(
  process.env.INERTIA_SSR_PORT ?? process.env.PORT ?? 13714,
);

createServer(async (page) => {
  const result = await renderInertiaPage(page as never);
  return {
    head: Array.isArray(result.head) ? result.head : [result.head],
    body: result.body,
  };
}, port);
