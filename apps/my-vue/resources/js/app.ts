import { createInertiaApp } from "@inertiajs/vue3";
import { createApp, createSSRApp, h } from "vue";
import { pages } from "virtual:pages";

const appName = document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content ?? "";

void createInertiaApp({
  title: (title) => (title ? `${title} - ${appName}` : appName),
  resolve: async (name) => {
    const page = pages[name];
    if (!page) throw new Error(`Page not found: resources/js/pages/${name}.vue`);
    return (await page()).default;
  },
  setup({ el, App, props, plugin }) {
    // The first page arrives rendered on the server (`config/inertia.ts`); hydrate it.
    const create = el!.hasAttribute("data-server-rendered") ? createSSRApp : createApp;
    create({ render: () => h(App, props) }).use(plugin).mount(el!);
  },
  progress: { color: "var(--color-primary)" },
});
