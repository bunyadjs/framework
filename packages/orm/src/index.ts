export {
  Model,
  ModelQuery,
  HasMany,
  HasManyThrough,
  HasOne,
  HasOneThrough,
  BelongsTo,
  BelongsToMany,
  MorphToMany,
  MorphedByMany,
  MorphMany,
  MorphOne,
  MorphTo,
  morphMap,
  enforceMorphMap,
  requireMorphMap,
  getMorphedModel,
  clearMorphMap,
  eagerLoadModels,
  eagerLoadAggregates,
  ModelNotFoundException,
  LazyLoadingViolationException,
  MassAssignmentException,
  MissingAttributeException,
  resetModelStrictnessForTests,
  isModelCtor,
  Attribute,
  AsCollection,
  AsFluent,
  AsEnumCollection,
  resetModelEventsForTests,
  type ModelClass,
  type RelationFactory,
  type RelationsMap,
  type CastType,
  type CastDefinition,
  type EnumCast,
  type ModelEventName,
  type ModelEventListener,
  type ModelObserver,
  type ModelQueryOptions,
  type EagerAggregateSpec,
  type MorphToManyOptions,
  resolveConnection,
} from "./model.ts";
export type { GlobalScopeCallback } from "./scopes.ts";
export { clearGlobalScopes } from "./scopes.ts";
export {
  UseBuilder,
  resolveModelBuilder,
  type ModelBuilderConstructor,
} from "./decorators.ts";
export {
  HasUuids,
  HasUlids,
  HasFactory,
  SoftDeletes,
  Prunable,
  MassPrunable,
  prune,
  pruneAll,
  prunableModelClasses,
  massPrunableModelClasses,
  clearPrunableRegistries,
  uuid7,
  ulid,
} from "./concerns.ts";
export { OrmCollection } from "./orm-collection.ts";
export {
  Factory,
  fake,
  type FactoryAttributes,
  type FactoryState,
  type FactorySequenceState,
  type FakeGenerator,
} from "./factory.ts";
export { Pivot } from "./pivot.ts";
export { LengthAwarePaginator } from "@bunyad/database";
export { Collection, collect } from "@bunyad/common";
export type { AggregateRelations } from "./model-query.ts";

/**
 * Type-level switch for the whole ORM, declared here (the package entry) so an app can augment it.
 *
 * Relation and column names are checked at compile time by default: `User.with("psots")` and
 * `User.where("emial", x)` are errors. To accept any string again, add this to a `.d.ts` file in your app:
 *
 * ```ts
 * declare module "@bunyad/orm" {
 *   interface OrmTypeOptions {
 *     strictNames: false;
 *   }
 * }
 * ```
 */
export interface OrmTypeOptions {}
export type {
  ColumnHint,
  ColumnNames,
  RelationHint,
  RelationNames,
} from "./typed-names.ts";
export { unsafeName } from "./typed-names.ts";
export { checkModelSchema, generateModelTypes, modelColumnsInterface, tsTypeForColumn, type SchemaIssue } from "./schema-types.ts";
