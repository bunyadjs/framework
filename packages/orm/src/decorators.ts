import type { ModelClass, ModelQuery, ModelQueryOptions } from "./model.ts";

const MODEL_BUILDER = Symbol.for("bunyad.orm.modelBuilder");

export type ModelBuilderConstructor = new (
  model: ModelClass,
  options?: ModelQueryOptions,
) => ModelQuery;

type ModelCtor = Function & {
  [MODEL_BUILDER]?: ModelBuilderConstructor;
};

/**
 * Use a custom `ModelQuery` subclass for this model’s `newQuery()` / `where()` / …
 */
export function UseBuilder(builder: ModelBuilderConstructor): ClassDecorator {
  return (target) => {
    (target as ModelCtor)[MODEL_BUILDER] = builder;
  };
}

export function resolveModelBuilder(
  model: Function,
): ModelBuilderConstructor | undefined {
  return (model as ModelCtor)[MODEL_BUILDER];
}
