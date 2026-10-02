import { ArrayFeatureStore } from "./array-store.ts";
import { isActiveValue, scopeKey } from "./scope.ts";
import type { FeatureDefinition, FeatureResolver, FeatureStore } from "./types.ts";

type NamedFeatures = string | string[];

function asNames(features: NamedFeatures): string[] {
  return Array.isArray(features) ? features : [features];
}

function isResolver(value: FeatureDefinition): value is FeatureResolver {
  return typeof value === "function";
}

/**
 * Scoped feature API returned by `Feature.for(scope)`.
 */
export class PendingScopedFeatures {
  readonly #manager: FeatureManager;
  readonly #scope: unknown;

  constructor(manager: FeatureManager, scope: unknown) {
    this.#manager = manager;
    this.#scope = scope;
  }

  active(features: NamedFeatures): Promise<boolean> {
    return this.#manager.active(features, this.#scope);
  }

  inactive(features: NamedFeatures): Promise<boolean> {
    return this.#manager.inactive(features, this.#scope);
  }

  value(feature: string): Promise<unknown> {
    return this.#manager.value(feature, this.#scope);
  }

  values(features: string[]): Promise<Record<string, unknown>> {
    return this.#manager.values(features, this.#scope);
  }

  allAreActive(features: string[]): Promise<boolean> {
    return this.#manager.allAreActive(features, this.#scope);
  }

  someAreActive(features: string[]): Promise<boolean> {
    return this.#manager.someAreActive(features, this.#scope);
  }

  allAreInactive(features: string[]): Promise<boolean> {
    return this.#manager.allAreInactive(features, this.#scope);
  }

  someAreInactive(features: string[]): Promise<boolean> {
    return this.#manager.someAreInactive(features, this.#scope);
  }

  activate(features: NamedFeatures, value: unknown = true): Promise<void> {
    return this.#manager.activate(features, value, this.#scope);
  }

  deactivate(features: NamedFeatures): Promise<void> {
    return this.#manager.deactivate(features, this.#scope);
  }

  forget(features: NamedFeatures): Promise<void> {
    return this.#manager.forget(features, this.#scope);
  }

  async when<T>(
    feature: string,
    whenActive: (value: unknown) => T | Promise<T>,
    whenInactive?: () => T | Promise<T>,
  ): Promise<T | undefined> {
    return this.#manager.when(feature, whenActive, whenInactive, this.#scope);
  }
}

/**
 * Feature feature manager — definitions + store + resolution cache.
 */
export class FeatureManager {
  #store: FeatureStore;
  readonly #definitions = new Map<string, FeatureDefinition>();
  readonly #resolved = new Map<string, unknown>();

  constructor(store: FeatureStore = new ArrayFeatureStore()) {
    this.#store = store;
  }

  store(): FeatureStore {
    return this.#store;
  }

  setStore(store: FeatureStore): this {
    this.#store = store;
    this.#resolved.clear();
    return this;
  }

  define(name: string, resolver: FeatureDefinition): this {
    this.#definitions.set(name, resolver);
    return this;
  }

  /** Defined feature names. */
  defined(): string[] {
    return [...this.#definitions.keys()];
  }

  for(scope: unknown): PendingScopedFeatures {
    return new PendingScopedFeatures(this, scope);
  }

  async active(features: NamedFeatures, scope: unknown = null): Promise<boolean> {
    const names = asNames(features);
    for (const name of names) {
      if (!isActiveValue(await this.value(name, scope))) return false;
    }
    return true;
  }

  async inactive(
    features: NamedFeatures,
    scope: unknown = null,
  ): Promise<boolean> {
    return !(await this.active(features, scope));
  }

  async allAreActive(features: string[], scope: unknown = null): Promise<boolean> {
    return this.active(features, scope);
  }

  async someAreActive(features: string[], scope: unknown = null): Promise<boolean> {
    for (const name of features) {
      if (isActiveValue(await this.value(name, scope))) return true;
    }
    return false;
  }

  async allAreInactive(
    features: string[],
    scope: unknown = null,
  ): Promise<boolean> {
    for (const name of features) {
      if (isActiveValue(await this.value(name, scope))) return false;
    }
    return true;
  }

  async someAreInactive(
    features: string[],
    scope: unknown = null,
  ): Promise<boolean> {
    for (const name of features) {
      if (!isActiveValue(await this.value(name, scope))) return true;
    }
    return false;
  }

  async value(feature: string, scope: unknown = null): Promise<unknown> {
    const key = this.#cacheKey(feature, scope);
    if (this.#resolved.has(key)) {
      return this.#resolved.get(key);
    }

    const scopeStr = scopeKey(scope);
    const stored = await this.#store.get(feature, scopeStr);
    if (stored !== undefined) {
      this.#resolved.set(key, stored);
      return stored;
    }

    const definition = this.#definitions.get(feature);
    if (definition === undefined) {
      throw new Error(`Feature [${feature}] is not defined.`);
    }

    const resolved = isResolver(definition)
      ? await definition(scope)
      : definition;

    await this.#store.set(feature, scopeStr, resolved);
    this.#resolved.set(key, resolved);
    return resolved;
  }

  async values(
    features: string[],
    scope: unknown = null,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    for (const name of features) {
      out[name] = await this.value(name, scope);
    }
    return out;
  }

  async activate(
    features: NamedFeatures,
    value: unknown = true,
    scope: unknown = null,
  ): Promise<void> {
    const scopeStr = scopeKey(scope);
    for (const name of asNames(features)) {
      await this.#store.set(name, scopeStr, value);
      this.#resolved.set(this.#cacheKey(name, scope), value);
    }
  }

  async deactivate(
    features: NamedFeatures,
    scope: unknown = null,
  ): Promise<void> {
    await this.activate(features, false, scope);
  }

  /**
   * Activate for every known scope row of the feature, plus the global scope.
   * We store under global and overwrite known scopes.
   */
  async activateForEveryone(
    features: NamedFeatures,
    value: unknown = true,
  ): Promise<void> {
    await this.activate(features, value, null);
  }

  async deactivateForEveryone(features: NamedFeatures): Promise<void> {
    await this.deactivate(features, null);
  }

  async forget(
    features: NamedFeatures,
    scope: unknown = null,
  ): Promise<void> {
    const scopeStr = scopeKey(scope);
    for (const name of asNames(features)) {
      await this.#store.delete(name, scopeStr);
      this.#resolved.delete(this.#cacheKey(name, scope));
    }
  }

  async purge(features?: NamedFeatures): Promise<void> {
    if (features == null) {
      await this.#store.purge();
    } else {
      await this.#store.purge(asNames(features));
    }
    this.#resolved.clear();
  }

  /** Drop in-memory resolution cache (does not touch the store). */
  flushCache(): this {
    this.#resolved.clear();
    return this;
  }

  async when<T>(
    feature: string,
    whenActive: (value: unknown) => T | Promise<T>,
    whenInactive?: () => T | Promise<T>,
    scope: unknown = null,
  ): Promise<T | undefined> {
    const value = await this.value(feature, scope);
    if (isActiveValue(value)) {
      return whenActive(value);
    }
    if (whenInactive) return whenInactive();
    return undefined;
  }

  #cacheKey(feature: string, scope: unknown): string {
    return `${feature}\0${scopeKey(scope)}`;
  }
}

let defaultManager: FeatureManager | undefined;

export function setFeatures(manager: FeatureManager): void {
  defaultManager = manager;
}

export function getFeatures(): FeatureManager {
  return defaultManager ?? (defaultManager = new FeatureManager());
}
