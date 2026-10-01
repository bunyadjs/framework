/** Feature definition resolver — may return a boolean or rich value. */
export type FeatureResolver = (
  scope: unknown,
) => unknown | Promise<unknown>;

export type FeatureDefinition = FeatureResolver | unknown;

export type FeatureStore = {
  get(name: string, scope: string): Promise<unknown | undefined>;
  set(name: string, scope: string, value: unknown): Promise<void>;
  delete(name: string, scope: string): Promise<void>;
  /** Delete all rows for a feature name (any scope). */
  purge(name?: string | string[]): Promise<void>;
};

export type FeatureIdentifier = {
  /** Custom scope string for Feature storage. */
  toFeatureIdentifier?(): string;
  id?: string | number;
};
