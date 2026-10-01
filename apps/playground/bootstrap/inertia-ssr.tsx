import { createInertiaApp } from "@inertiajs/react";
import type { ReactElement } from "react";
import ReactDOMServer from "react-dom/server";
import type { InertiaPage, SsrRenderResult } from "@bunyad/inertia";
import { resolvePage } from "../resources/js/pages.ts";

/**
 * In-process Inertia SSR renderer (no separate port).
 * Shared by InertiaServiceProvider (inline) and optional HTTP `ssr.tsx` worker.
 */
export async function renderInertiaPage(
  page: InertiaPage,
): Promise<SsrRenderResult> {
  // Cast: Bunyad's page is a subset of Inertia's `Page` (SSR overload needs the full shape).
  const result = await createInertiaApp({
    page: page as never,
    render: ReactDOMServer.renderToString,
    resolve: (name) => resolvePage(name),
    setup: ({ App, props }): ReactElement => <App {...props} />,
    serverHead: true,
  });

  return result;
}
