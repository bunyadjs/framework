import {
  FeatureManager,
  getFeatures,
  PendingScopedFeatures,
  setFeatures,
} from "./manager.ts";
import type { FeatureDefinition, FeatureStore } from "./types.ts";
import { ArrayFeatureStore } from "./array-store.ts";
import { FeatureFake } from "./feature-fake.ts";

/**
 * `Feature` facade.
 */
export const Feature = {
  define(name: string, resolver: FeatureDefinition): FeatureManager {
    return getFeatures().define(name, resolver);
  },

  for(scope: unknown): PendingScopedFeatures {
    return getFeatures().for(scope);
  },

  active(features: string | string[]): Promise<boolean> {
    return getFeatures().active(features);
  },

  inactive(features: string | string[]): Promise<boolean> {
    return getFeatures().inactive(features);
  },

  value(feature: string): Promise<unknown> {
    return getFeatures().value(feature);
  },

  values(features: string[]): Promise<Record<string, unknown>> {
    return getFeatures().values(features);
  },

  allAreActive(features: string[]): Promise<boolean> {
    return getFeatures().allAreActive(features);
  },

  someAreActive(features: string[]): Promise<boolean> {
    return getFeatures().someAreActive(features);
  },

  allAreInactive(features: string[]): Promise<boolean> {
    return getFeatures().allAreInactive(features);
  },

  someAreInactive(features: string[]): Promise<boolean> {
    return getFeatures().someAreInactive(features);
  },

  activate(features: string | string[], value: unknown = true): Promise<void> {
    return getFeatures().activate(features, value);
  },

  deactivate(features: string | string[]): Promise<void> {
    return getFeatures().deactivate(features);
  },

  activateForEveryone(
    features: string | string[],
    value: unknown = true,
  ): Promise<void> {
    return getFeatures().activateForEveryone(features, value);
  },

  deactivateForEveryone(features: string | string[]): Promise<void> {
    return getFeatures().deactivateForEveryone(features);
  },

  forget(features: string | string[]): Promise<void> {
    return getFeatures().forget(features);
  },

  purge(features?: string | string[]): Promise<void> {
    return getFeatures().purge(features);
  },

  flushCache(): FeatureManager {
    return getFeatures().flushCache();
  },

  when<T>(
    feature: string,
    whenActive: (value: unknown) => T | Promise<T>,
    whenInactive?: () => T | Promise<T>,
  ): Promise<T | undefined> {
    return getFeatures().when(feature, whenActive, whenInactive);
  },

  /** Swap the underlying store (array / database). */
  useStore(store: FeatureStore): FeatureManager {
    return getFeatures().setStore(store);
  },

  /** Reset to a fresh in-memory manager (tests). */
  fake(): FeatureFake {
    const fake = new FeatureFake();
    setFeatures(fake);
    return fake;
  },

  /** Restore a clean array-backed manager after `Feature.fake()`. */
  restore(): FeatureManager {
    const manager = new FeatureManager(new ArrayFeatureStore());
    setFeatures(manager);
    return manager;
  },

  defined(): string[] {
    return getFeatures().defined();
  },

  getFeatures,
  setFeatures,
};
