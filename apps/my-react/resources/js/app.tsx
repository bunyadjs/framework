import { createInertiaApp } from "@inertiajs/react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { pages } from "virtual:pages";

const appName = document.querySelector<HTMLMetaElement>('meta[name="application-name"]')?.content ?? "";

void createInertiaApp({
  title: (title) => (title ? `${title} - ${appName}` : appName),
  resolve: async (name) => {
    const page = pages[name];
    if (!page) throw new Error(`Page not found: resources/js/pages/${name}.tsx`);
    return (await page()).default;
  },
  setup({ el, App, props }) {
    // The first page arrives rendered on the server (`config/inertia.ts`); hydrate it.
    if (el!.hasAttribute("data-server-rendered")) hydrateRoot(el!, <App {...props} />);
    else createRoot(el!).render(<App {...props} />);
  },
  progress: { color: "var(--color-primary)" },
});
