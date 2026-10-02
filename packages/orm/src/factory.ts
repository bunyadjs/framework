import type { Model, ModelClass } from "./model.ts";

export type FactoryAttributes = Record<string, unknown>;

export type FactoryState =
  | FactoryAttributes
  | ((
      attributes: FactoryAttributes,
    ) => FactoryAttributes | Promise<FactoryAttributes>);

export type FactorySequenceState =
  | FactoryAttributes
  | ((sequence: number) => FactoryAttributes);

type HasRelationSpec = {
  factory: Factory<any>;
  relationship?: string;
};

type ForRelationSpec = {
  parent: Model | Factory<any>;
  relationship?: string;
};

type HasAttachedSpec = {
  related: Factory<any> | Model | Model[];
  pivot?: FactoryAttributes;
  relationship?: string;
};

/**
 * Stored as `Model` so `Factory<User>` stays assignable to `Factory`.
 * The public methods still accept `(model: T)`.
 */
type FactoryCallback = (model: Model) => void | Promise<void>;

/**
 * Lightweight faker for factory definitions (`fake().email()`).
 */
export type FakeGenerator = {
  uuid(): string;
  word(): string;
  words(count?: number): string;
  sentence(): string;
  name(): string;
  firstName(): string;
  lastName(): string;
  email(): string;
  number(max?: number): number;
  boolean(): boolean;
};

const WORDS = [
  "alpha",
  "bravo",
  "cedar",
  "delta",
  "ember",
  "flint",
  "grove",
  "harbor",
  "ivory",
  "jade",
  "kite",
  "lunar",
  "maple",
  "nova",
  "orbit",
  "pine",
  "quartz",
  "river",
  "sage",
  "tide",
];

function pickWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)]!;
}

/** Bun-friendly faker used inside factory `definition()`. */
export function fake(): FakeGenerator {
  return {
    uuid: () => crypto.randomUUID(),
    word: () => pickWord(),
    words(count = 3) {
      return Array.from({ length: count }, () => pickWord()).join(" ");
    },
    sentence() {
      const text = this.words(6);
      return text.charAt(0).toUpperCase() + text.slice(1) + ".";
    },
    firstName: () => pickWord().replace(/^./, (c) => c.toUpperCase()),
    lastName: () => pickWord().replace(/^./, (c) => c.toUpperCase()),
    name() {
      return `${this.firstName()} ${this.lastName()}`;
    },
    email() {
      return `${pickWord()}.${pickWord()}${Math.floor(Math.random() * 1000)}@example.test`;
    },
    number(max = 1000) {
      return Math.floor(Math.random() * Math.max(1, max));
    },
    boolean: () => Math.random() >= 0.5,
  };
}

function singularTable(table: string): string {
  if (table.endsWith("ies")) return `${table.slice(0, -3)}y`;
  if (table.endsWith("s")) return table.slice(0, -1);
  return table;
}

function guessRelationName(from: ModelClass, related: ModelClass): string {
  const base = related.name.replace(/Factory$/, "");
  const singular = base.charAt(0).toLowerCase() + base.slice(1);
  const plural = singular.endsWith("s") ? singular : `${singular}s`;
  const parent = new from();
  for (const candidate of [plural, singular]) {
    try {
      parent.related(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return plural;
}

/**
 * Model factory — `definition` / `make` / `create` / `count`, plus
 * fluent `state`, `sequence`, relationship helpers, and lifecycle callbacks.
 */
/** Marks a factory after `count()`, so `create()` / `make()` type as `T[]`. */
type ManyModels = { readonly __many: true };

export abstract class Factory<T extends Model = Model> {
  #count = 1;
  #many = false;
  #states: FactoryState[] = [];
  #sequences: FactorySequenceState[] = [];
  #sequenceIndex = 0;
  #afterMaking: FactoryCallback[] = [];
  #afterCreating: FactoryCallback[] = [];
  #has: HasRelationSpec[] = [];
  #for: ForRelationSpec[] = [];
  #hasAttached: HasAttachedSpec[] = [];

  protected abstract model(): ModelClass;

  /** Public model class accessor for relationship factories. */
  modelClass(): ModelClass {
    return this.model();
  }

  definition(): FactoryAttributes | Promise<FactoryAttributes> {
    return {};
  }

  /** Number of models to make/create. */
  count(amount: number): this & ManyModels {
    this.#count = amount;
    this.#many = true;
    return this as this & ManyModels;
  }

  /** Merge attribute overrides (object or callback) into every model. */
  state(state: FactoryState): this {
    this.#states.push(state);
    return this;
  }

  /**
   * Cycle attribute sets across models.
   * Sequence callbacks receive a 1-based index.
   */
  sequence(...states: FactorySequenceState[]): this {
    this.#sequences.push(...states);
    return this;
  }

  /** Run after an in-memory model is built (`make` / before persist). */
  afterMaking(callback: (model: T) => void | Promise<void>): this {
    this.#afterMaking.push(callback as FactoryCallback);
    return this;
  }

  /** Run after a model is persisted (`create`). */
  afterCreating(callback: (model: T) => void | Promise<void>): this {
    this.#afterCreating.push(callback as FactoryCallback);
    return this;
  }

  /**
   * Create related models after the parent (`has(PostFactory.new().count(3))`).
   */
  has(factory: Factory<any>, relationship?: string): this {
    this.#has.push({ factory, relationship });
    return this;
  }

  /**
   * Associate a parent model / factory (`for(TeamFactory.new())`).
   */
  for(parent: Model | Factory<any>, relationship?: string): this {
    this.#for.push({ parent, relationship });
    return this;
  }

  /**
   * Attach related models on a belongs-to-many after create.
   */
  hasAttached(
    related: Factory<any> | Model | Model[],
    pivot: FactoryAttributes = {},
    relationship?: string,
  ): this {
    this.#hasAttached.push({ related, pivot, relationship });
    return this;
  }

  /** `Factory::new()`. */
  static new<T extends Factory>(this: new () => T): T {
    return new this();
  }

  async #resolveAttributes(
    attributes: FactoryAttributes = {},
  ): Promise<FactoryAttributes> {
    let attrs: FactoryAttributes = { ...(await this.definition()) };
    for (const state of this.#states) {
      const patch =
        typeof state === "function" ? await state(attrs) : state;
      attrs = { ...attrs, ...patch };
    }
    if (this.#sequences.length > 0) {
      this.#sequenceIndex += 1;
      const seq =
        this.#sequences[(this.#sequenceIndex - 1) % this.#sequences.length]!;
      const patch =
        typeof seq === "function" ? seq(this.#sequenceIndex) : seq;
      attrs = { ...attrs, ...patch };
    }
    for (const spec of this.#for) {
      const parentModel =
        spec.parent instanceof Factory
          ? ((await spec.parent.create()) as Model)
          : spec.parent;
      const ParentCtor = parentModel.constructor as ModelClass;
      const fkName = spec.relationship?.endsWith("_id")
        ? spec.relationship
        : spec.relationship
          ? `${spec.relationship}_id`
          : `${singularTable(ParentCtor.table)}_id`;
      attrs[fkName] = (parentModel as unknown as Record<string, unknown>)[
        ParentCtor.primaryKey
      ];
    }
    return { ...attrs, ...attributes };
  }

  async #createRelated(parent: T): Promise<void> {
    const ParentCtor = parent.constructor as ModelClass;
    const parentId = (parent as unknown as Record<string, unknown>)[
      ParentCtor.primaryKey
    ];
    for (const spec of this.#has) {
      const RelatedCtor = spec.factory.modelClass();
      const relName =
        spec.relationship ?? guessRelationName(ParentCtor, RelatedCtor);
      let fk = `${singularTable(ParentCtor.table)}_id`;
      let useAttach = false;
      try {
        const rel = parent.related(relName) as {
          getForeignKeyName?: () => string;
          attach?: (ids: Array<string | number>) => Promise<void>;
        };
        if (typeof rel.attach === "function") {
          useAttach = true;
        } else if (typeof rel.getForeignKeyName === "function") {
          fk = rel.getForeignKeyName();
        }
      } catch {
        // use default fk
      }

      if (useAttach) {
        const related = await spec.factory.create();
        const list = Array.isArray(related) ? related : [related];
        const rel = parent.related(relName) as {
          attach: (ids: Array<string | number>) => Promise<void>;
        };
        const ids = list.map(
          (m) =>
            (m as unknown as Record<string, unknown>)[
              (m.constructor as ModelClass).primaryKey
            ] as string | number,
        );
        await rel.attach(ids);
        continue;
      }

      await spec.factory.state({ [fk]: parentId }).create();
    }

    for (const spec of this.#hasAttached) {
      let models: Model[];
      if (spec.related instanceof Factory) {
        const created = await spec.related.create();
        models = Array.isArray(created) ? created : [created];
      } else if (Array.isArray(spec.related)) {
        models = spec.related;
      } else {
        models = [spec.related];
      }
      if (models.length === 0) continue;
      const RelatedCtor = models[0]!.constructor as ModelClass;
      const relName =
        spec.relationship ?? guessRelationName(ParentCtor, RelatedCtor);
      const rel = parent.related(relName) as {
        attach: (ids: Array<string | number>) => Promise<void>;
      };
      const ids = models.map(
        (m) =>
          (m as unknown as Record<string, unknown>)[
            (m.constructor as ModelClass).primaryKey
          ] as string | number,
      );
      await rel.attach(ids);
      void spec.pivot;
    }
  }

  /** Build an in-memory model instance (not persisted). */
  async make(
    attributes: FactoryAttributes = {},
  ): Promise<this extends ManyModels ? T[] : T> {
    const n = this.#count;
    const many = this.#many;
    this.#count = 1;
    this.#many = false;
    const ModelClass = this.model();
    const items: T[] = [];
    for (let i = 0; i < n; i++) {
      const base = await this.#resolveAttributes(attributes);
      const model = new ModelClass(base) as T;
      for (const cb of this.#afterMaking) {
        await cb(model);
      }
      items.push(model);
    }
    return (many ? items : items[0]!) as never;
  }

  /** Persist model(s) via `Model.forceCreate` (factories set guarded columns too). */
  async create(
    attributes: FactoryAttributes = {},
  ): Promise<this extends ManyModels ? T[] : T> {
    const n = this.#count;
    const many = this.#many;
    this.#count = 1;
    this.#many = false;
    const ModelClass = this.model();
    const items: T[] = [];
    for (let i = 0; i < n; i++) {
      const base = await this.#resolveAttributes(attributes);
      const model = (await ModelClass.forceCreate(base)) as T;
      for (const cb of this.#afterMaking) {
        await cb(model);
      }
      for (const cb of this.#afterCreating) {
        await cb(model);
      }
      await this.#createRelated(model);
      items.push(model);
    }
    return (many ? items : items[0]!) as never;
  }
}
