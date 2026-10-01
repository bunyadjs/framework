import { ServiceProvider } from "@bunyad/core";
import type { Connection } from "@bunyad/database";
import { DatabaseFeatureStore, Feature } from "@bunyad/features";

export type FeatureConfig = {
  default?: string;
};

/**
 * Load the Feature store from `config/features.ts` / `FEATURES_STORE`.
 * Defaults to the in-memory array driver when unset.
 */
export class FeatureServiceProvider extends ServiceProvider {
  register(): void {
    const config =
      this.app.config.get<FeatureConfig>("features") ??
      this.app.config.get<FeatureConfig>("pennant");
    const driver =
      config?.default ?? process.env.FEATURES_STORE ?? process.env.PENNANT_STORE;
    if (driver !== "database") return;

    const connection = this.app.make<Connection>("db");
    Feature.useStore(new DatabaseFeatureStore({ connection }));
  }
}
