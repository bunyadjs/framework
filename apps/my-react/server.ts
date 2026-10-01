import { serve } from "@bunyad/core";
import { createApplication } from "./bootstrap/app.ts";

const app = await createApplication();
serve(app);
