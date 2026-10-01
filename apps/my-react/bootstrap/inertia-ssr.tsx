import { resolve } from "node:path";
import { createInertiaApp } from "@inertiajs/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { InertiaPage, SsrRenderResult } from "@bunyad/inertia";

const pages = resolve(import.meta.dir, "../resources/js/pages");

/**
 * Renders a page on the server for the first visit (`config/inertia.ts`).
 * Pages load straight from `resources/js/pages`; the browser bundle is not used.
 */
export async function renderInertiaPage(page: InertiaPage): Promise<SsrRenderResult> {
  const appName = config<string>("app.name");
  return createInertiaApp({
    // Bunyad's page object is the part of Inertia's `Page` the server sends.
    page: page as never,
    render: renderToString,
    title: (title) => (title ? `${title} - ${appName}` : appName),
    resolve: async (name) => (await import(`${pages}/${name}.tsx`)).default,
    setup: ({ App, props }): ReactElement => <App {...props} />,
  });
}
