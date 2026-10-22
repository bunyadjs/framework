import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { plugin } from "bun";
import { SveltePlugin } from "bun-plugin-svelte";
import { render } from "svelte/server";
import type { InertiaPage, SsrRenderResult } from "@bunyad/inertia";

// `.svelte` pages (and `.svelte.ts` modules) compile on import, for the server.
plugin(SveltePlugin({ forceSide: "server" }));

const tree = resolve(import.meta.dir, "../../routes");

/** The `*Layout.svelte` of each folder from `routes/` down to the page, outermost first (one per folder). */
function layoutFiles(name: string): string[] {
  const parts = name.split("/").slice(0, -1);
  const found: string[] = [];
  for (let i = 0; i <= parts.length; i++) {
    const dir = resolve(tree, ...parts.slice(0, i));
    const layout = readdirSync(dir).find((entry) => /Layout\.svelte$/.test(entry));
    if (layout) found.push(resolve(dir, layout));
  }
  return found;
}

/** A page with its layouts, the way the browser entry does it (`bunyad build`). */
async function loadPage(name: string) {
  const mod = await import(`${tree}/${name}.svelte`);
  const layouts = await Promise.all(layoutFiles(name).map((file) => import(file)));
  const chain = layouts.slice(Math.max(layouts.map((layout) => layout.reset === true).lastIndexOf(true), 0)).map((layout) => layout.default);
  if (mod.layout !== undefined || chain.length === 0) return mod;
  return {
    default: mod.default,
    // Named functions with a prototype: the adapter takes those for components, not render functions.
    layout: chain.map((Layout: any) =>
      function PageLayout(anchor: unknown, props: any) {
        return Layout(anchor, {
          get meta() {
            return typeof mod.meta === "function" ? mod.meta(props) : (mod.meta ?? {});
          },
          get children() {
            return props.children;
          },
        });
      },
    ),
  };
}

/**
 * Renders a page on the server for the first visit (`config/inertia.ts`).
 * Pages load straight from their folders under `routes`; the browser bundle is not used.
 */
export async function renderInertiaPage(page: InertiaPage): Promise<SsrRenderResult> {
  // Imported after the plugin above is registered: the adapter ships .svelte files.
  // It is published only under the "svelte" export condition, which the server does not
  // use, so tsconfig maps `@inertiajs/svelte` to that file.
  const { createInertiaApp } = await import("@inertiajs/svelte");
  return (await createInertiaApp({
    // Bunyad's page object is the part of Inertia's `Page` the server sends.
    page: page as never,
    // The Svelte adapter takes the module (`default`, and an optional `layout`).
    resolve: (name) => loadPage(name),
    setup: ({ App, props }) => render(App, { props }),
  })) as SsrRenderResult;
}
