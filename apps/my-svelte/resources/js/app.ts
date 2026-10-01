import { createInertiaApp } from "@inertiajs/svelte";
import { hydrate, mount } from "svelte";
import { pages } from "virtual:pages";

void createInertiaApp({
  resolve: async (name) => {
    const page = pages[name];
    if (!page) throw new Error(`Page not found: resources/js/pages/${name}.svelte`);
    // The Svelte adapter takes the module (`default`, and an optional `layout`).
    return page();
  },
  setup({ el, App, props }) {
    // The first page arrives rendered on the server (`config/inertia.ts`); hydrate it.
    if (el!.hasAttribute("data-server-rendered")) hydrate(App, { target: el!, props });
    else mount(App, { target: el!, props });
  },
  progress: { color: "var(--color-primary)" },
});
