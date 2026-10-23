import { createInertiaApp } from "@inertiajs/svelte";
import { hydrate, mount } from "svelte";
import { pages } from "virtual:pages";

void createInertiaApp({
  resolve: async (name: string) => {
    const entry = pages[name];
    if (!entry) throw new Error(`Page not found: resources/js/pages/${name}.svelte`);
    // The Svelte adapter takes the module (`default`, and an optional `layout`).
    return entry.page();
  },
  setup({ el, App, props }: { el: HTMLElement | null; App: never; props: never }) {
    // The first page arrives rendered on the server (`config/inertia.ts`); hydrate it.
    if (el!.hasAttribute("data-server-rendered")) hydrate(App, { target: el!, props });
    else mount(App, { target: el!, props });
  },
  progress: { color: "var(--color-primary)" },
});
