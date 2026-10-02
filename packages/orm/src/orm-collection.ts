import { Collection } from "@bunyad/common";
import type { EagerAggregateSpec, Model, ModelClass } from "./model.ts";

function relationLoaded(model: Model, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(model, name);
}

function parseRelationAlias(raw: string): { relation: string; alias?: string } {
  const m = raw.match(/^(.+?)\s+as\s+(.+)$/i);
  if (!m) return { relation: raw.trim() };
  return { relation: m[1]!.trim(), alias: m[2]!.trim() };
}

/**
 * ORM model collection (`get()` / relation `get()`).
 */
export class OrmCollection<T extends Model = Model> extends Collection<T> {
  constructor(
    items: T[] | Collection<T> | Iterable<T> | null | undefined = [],
    options?: { owned?: boolean },
  ) {
    super(items, options);
  }

  /** Fresh `items` array — no copy. */
  protected override make(items: T[]): OrmCollection<T> {
    return new OrmCollection(items, { owned: true });
  }

  /**
   * Eager-load relations onto every model (`load('posts')` / constrained maps).
   */
  async load(
    ...relations: Array<string | Record<string, unknown>>
  ): Promise<this> {
    if (relations.length === 0 || this.isEmpty()) return this;
    const { eagerLoadModels } = await import("./model.ts");
    const { normalizeWithRelations } = await import("./model-helpers.ts");
    await eagerLoadModels(this.all() as Model[], normalizeWithRelations(relations));
    return this;
  }

  /**
   * Load only relations that are not already present (`loadMissing`).
   */
  async loadMissing(
    ...relations: Array<string | Record<string, unknown>>
  ): Promise<this> {
    const { normalizeWithRelations } = await import("./model-helpers.ts");
    const normalized = normalizeWithRelations(relations);
    const missing = normalized.filter((entry) =>
      this.items.some((model) => !relationLoaded(model, entry.name)),
    );
    if (missing.length === 0) return this;
    if (this.isEmpty()) return this;
    const { eagerLoadModels } = await import("./model.ts");
    await eagerLoadModels(this.all() as Model[], missing);
    return this;
  }

  /** `$collection->loadCount(...)` — batched GROUP BY per relation. */
  async loadCount(...relations: string[]): Promise<this> {
    return this.#loadAggregates(
      relations.flat().map((raw) => {
        const parsed = parseRelationAlias(raw);
        return {
          relation: parsed.relation,
          alias: parsed.alias ?? `${parsed.relation}_count`,
          fn: "count" as const,
        };
      }),
    );
  }

  async loadSum(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    return this.#loadAggregates([
      {
        relation: parsed.relation,
        alias: parsed.alias ?? `${parsed.relation}_sum_${column}`,
        fn: "sum",
        column,
      },
    ]);
  }

  async loadAvg(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    return this.#loadAggregates([
      {
        relation: parsed.relation,
        alias: parsed.alias ?? `${parsed.relation}_avg_${column}`,
        fn: "avg",
        column,
      },
    ]);
  }

  async loadMin(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    return this.#loadAggregates([
      {
        relation: parsed.relation,
        alias: parsed.alias ?? `${parsed.relation}_min_${column}`,
        fn: "min",
        column,
      },
    ]);
  }

  async loadMax(relation: string, column: string): Promise<this> {
    const parsed = parseRelationAlias(relation);
    return this.#loadAggregates([
      {
        relation: parsed.relation,
        alias: parsed.alias ?? `${parsed.relation}_max_${column}`,
        fn: "max",
        column,
      },
    ]);
  }

  async loadExists(...relations: string[]): Promise<this> {
    return this.#loadAggregates(
      relations.flat().map((raw) => {
        const parsed = parseRelationAlias(raw);
        return {
          relation: parsed.relation,
          alias: parsed.alias ?? `${parsed.relation}_exists`,
          fn: "exists" as const,
        };
      }),
    );
  }

  async #loadAggregates(specs: EagerAggregateSpec[]): Promise<this> {
    if (specs.length === 0 || this.isEmpty()) return this;
    const { eagerLoadAggregates } = await import("./model.ts");
    await eagerLoadAggregates(this.all() as Model[], specs);
    return this;
  }

  /** Primary keys of all models. */
  modelKeys(): Collection<unknown> {
    return this.map((model) => {
      const ctor = model.constructor as ModelClass;
      return (model as unknown as Record<string, unknown>)[ctor.primaryKey];
    });
  }

  /**
   * Find model(s) by primary key (`$collection->find($id)`).
   * Pass an array of keys to return a filtered OrmCollection.
   */
  find(key: string | number | bigint): T | null;
  find(keys: Array<string | number | bigint>): OrmCollection<T>;
  find(
    key: string | number | bigint | Array<string | number | bigint>,
  ): T | null | OrmCollection<T> {
    if (Array.isArray(key)) {
      const want = new Set(key.map(String));
      return this.make(
        this.items.filter((model) => {
          const ctor = model.constructor as ModelClass;
          const id = (model as unknown as Record<string, unknown>)[
            ctor.primaryKey
          ];
          return want.has(String(id));
        }),
      );
    }
    const want = String(key);
    return (
      this.items.find((model) => {
        const ctor = model.constructor as ModelClass;
        const id = (model as unknown as Record<string, unknown>)[
          ctor.primaryKey
        ];
        return String(id) === want;
      }) ?? null
    );
  }

  findOrFail(key: string | number | bigint): T {
    const model = this.find(key);
    if (!model) {
      throw new Error(`No query results for model [${String(key)}].`);
    }
    return model;
  }
}
