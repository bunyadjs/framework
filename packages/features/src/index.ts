export type {
  FeatureDefinition,
  FeatureResolver,
  FeatureStore,
  FeatureIdentifier,
} from "./types.ts";
export { scopeKey, isActiveValue, NULL_SCOPE } from "./scope.ts";
export { ArrayFeatureStore } from "./array-store.ts";
export {
  DatabaseFeatureStore,
  type DatabaseFeatureStoreOptions,
  type FeatureConnection,
} from "./database-store.ts";
export {
  FeatureManager,
  PendingScopedFeatures,
  getFeatures,
  setFeatures,
} from "./manager.ts";
export { Feature } from "./feature.ts";
export { FeatureFake } from "./feature-fake.ts";
export {
  ensureFeaturesAreActive,
} from "./middleware.ts";
