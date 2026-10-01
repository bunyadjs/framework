import { ServiceProvider } from "@bunyad/core";
import { discoverLive } from "../discovery.ts";

/** Auto-register `app/Live` components (kebab-case names). */
export class LiveServiceProvider extends ServiceProvider {
  async boot(): Promise<void> {
    await discoverLive(this.app);
  }
}
