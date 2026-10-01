import { resolve } from "node:path";
import { plugin } from "bun";
import { SveltePlugin } from "bun-plugin-svelte";
import { render } from "svelte/server";
import type { InertiaPage, SsrRenderResult } from "@bunyad/inertia";

// `.svelte` pages (and `.svelte.ts` modules) compile on import, for the server.
plugin(SveltePlugin({ forceSide: "server" }));

const pages = resolve(import.meta.dir, "../resources/js/pages");

/**
 * Renders a page on the server for the first visit (`config/inertia.ts`).
 * Pages load straight from `resources/js/pages`; the browser bundle is not used.
 */
export async function renderInertiaPage(page: InertiaPage): Promise<SsrRenderResult> {
  // Imported after the plugin above is registered: the adapter ships .svelte files.
  // It is published only under the "svelte" export condition, which the server does not
  // use, so both tsconfigs map `@inertiajs/svelte` to that file.
  const { createInertiaApp } = await import("@inertiajs/svelte");
  return (await createInertiaApp({
    // Bunyad's page object is the part of Inertia's `Page` the server sends.
    page: page as never,
    // The Svelte adapter takes the module (`default`, and an optional `layout`).
    resolve: (name) => import(`${pages}/${name}.svelte`),
    setup: ({ App, props }) => render(App, { props }),
  })) as SsrRenderResult;
}
