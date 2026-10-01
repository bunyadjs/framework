import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@bunyad/core";
import { createApplication } from "./bootstrap/app.ts";
import { warm } from "./app/Docs/cache.ts";

const root = dirname(fileURLToPath(import.meta.url));

await warm();
const app = await createApplication();
serve(app, {
  refresh: [
    join(root, "resources/docs"),
    join(root, "app"),
    join(root, "routes"),
    join(root, "public"),
  ],
});
