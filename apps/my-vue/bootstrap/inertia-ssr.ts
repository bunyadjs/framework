import { resolve } from "node:path";
import { createInertiaApp } from "@inertiajs/vue3";
import { plugin } from "bun";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import type { InertiaPage, SsrRenderResult } from "@bunyad/inertia";
import { vue } from "../scripts/vue-plugin.ts";

// `.vue` pages compile on import, as they do for the browser bundle.
plugin(vue);

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
    resolve: async (name) => (await import(`${pages}/${name}.vue`)).default,
    setup: ({ App, props, plugin: inertia }) => createSSRApp({ render: () => h(App, props) }).use(inertia),
  }) as Promise<SsrRenderResult>;
}
