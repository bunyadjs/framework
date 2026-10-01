import { createInertiaApp } from "@inertiajs/react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { resolvePage } from "./pages";

void createInertiaApp({
  resolve: (name) => resolvePage(name),
  setup({ el, App, props }) {
    const app = <App {...props} />;
    if (el.hasAttribute("data-server-rendered")) {
      hydrateRoot(el, app);
    } else {
      createRoot(el).render(app);
    }
  },
  serverHead: true,
  progress: {
    color: "#0f766e",
    delay: 120,
  },
});
