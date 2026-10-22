import { bunyad } from "@bunyad/framework";
import AppServiceProvider from "@/Providers/AppServiceProvider.ts";

// An API: no session, views or Inertia.
export const createApplication = bunyad(import.meta, {
  except: ["view", "session", "live", "head", "inertia"],
  providers: [AppServiceProvider],
});
