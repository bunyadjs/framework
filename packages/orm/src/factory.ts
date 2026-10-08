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
  pivot?: FactoryAttributes | ((model: Model) => FactoryAttributes);
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
  #configured = false;
  /** Parents created from `for(Factory)` — one per batch, shared by every model in it. */
  #forParents = new Map<ForRelationSpec, Model>();

  protected abstract model(): ModelClass;

  /** Public model class accessor for relationship factories. */
  modelClass(): ModelClass {
    return this.model();
  }

  definition(): FactoryAttributes | Promise<FactoryAttributes> {
    return {};
  }

  /** Runs once, before the first `make` / `create` (`afterMaking`, default states, …). */
  configure(): this {
    return this;
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
    pivot: FactoryAttributes | ((model: Model) => FactoryAttributes) = {},
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
      let parentModel: Model;
      if (spec.parent instanceof Factory) {
        let created = this.#forParents.get(spec);
        if (!created) {
          created = (await spec.parent.create()) as Model;
          this.#forParents.set(spec, created);
        }
        parentModel = created;
      } else {
        parentModel = spec.parent;
      }
      const ParentCtor = parentModel.constructor as ModelClass;
      const fkName = spec.relationship?.endsWith("_id")
        ? spec.relationship
        : this.#belongsToKey(ParentCtor, spec.relationship);
      attrs[fkName] = (parentModel as unknown as Record<string, unknown>)[
        ParentCtor.primaryKey
      ];
    }
    return { ...attrs, ...attributes };
  }

  /**
   * Foreign key for `for(parent)`: the child's `belongsTo` relation named after
   * the parent class (Laravel guesses `team()` for a `Team`), else `team_id`.
   */
  #belongsToKey(Parent: ModelClass, relationship?: string): string {
    const camel = relationship ?? Parent.name.charAt(0).toLowerCase() + Parent.name.slice(1);
    try {
      const rel = new (this.model())().related(camel) as unknown as {
        getForeignKeyName?: () => string;
      };
      if (typeof rel.getForeignKeyName === "function") return rel.getForeignKeyName();
    } catch {
      // no such relation on the child model
    }
    const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    return `${snake}_id`;
  }

  async #createRelated(parent: T): Promise<void> {
    const ParentCtor = parent.constructor as ModelClass;
    const parentId = (parent as unknown as Record<string, unknown>)[
      ParentCtor.primaryKey
    ];
    const idsOf = (list: Model[]) =>
      list.map(
        (m) =>
          (m as unknown as Record<string, unknown>)[
            (m.constructor as ModelClass).primaryKey
          ] as string | number,
      );

    for (const spec of this.#has) {
      const RelatedCtor = spec.factory.modelClass();
      const relName =
        spec.relationship ?? guessRelationName(ParentCtor, RelatedCtor);
      let fk = `${singularTable(ParentCtor.table)}_id`;
      let fixed: FactoryAttributes | null = null;
      let rel: Record<string, unknown> | null = null;
      try {
        rel = parent.related(relName) as unknown as Record<string, unknown>;
      } catch {
        // fall back to the conventional foreign key
      }
      if (rel && typeof rel.attach === "function") {
        const created = await spec.factory.create();
        const list = (Array.isArray(created) ? created : [created]) as Model[];
        await (rel.attach as (ids: Array<string | number>) => Promise<void>)(idsOf(list));
        continue;
      }
      if (rel && typeof rel.getTypeColumn === "function") {
        // morphOne / morphMany: set both the id and the type column.
        fixed = {
          [(rel.getIdColumn as () => string)()]: parentId,
          [(rel.getTypeColumn as () => string)()]: (rel.getMorphType as () => string)(),
        };
      } else if (rel && typeof rel.getForeignKeyName === "function") {
        fk = (rel.getForeignKeyName as () => string)();
      }
      await spec.factory.state(fixed ?? { [fk]: parentId }).create();
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
        attach: (
          ids: Array<string | number> | Record<string | number, FactoryAttributes>,
          attributes?: FactoryAttributes,
        ) => Promise<void>;
      };
      const pivot = spec.pivot;
      if (typeof pivot === "function") {
        // Per-model pivot attributes.
        const map: Record<string, FactoryAttributes> = {};
        for (const m of models) map[String(idsOf([m])[0])] = pivot(m);
        await rel.attach(map);
      } else {
        await rel.attach(idsOf(models), pivot ?? {});
      }
    }
  }

  #begin(): { n: number; many: boolean } {
    if (!this.#configured) {
      this.#configured = true;
      this.configure();
    }
    const out = { n: this.#count, many: this.#many };
    this.#count = 1;
    this.#many = false;
    this.#forParents.clear();
    return out;
  }

  /** Build an in-memory model instance (not persisted). */
  async make(
    attributes: FactoryAttributes = {},
  ): Promise<this extends ManyModels ? T[] : T> {
    const { n, many } = this.#begin();
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
    const { n, many } = this.#begin();
    const ModelClass = this.model();
    const items: T[] = [];
    for (let i = 0; i < n; i++) {
      const base = await this.#resolveAttributes(attributes);
      // `afterMaking` runs on the unsaved model, then it is persisted (Laravel order).
      const model = (await ModelClass.forceCreate(base, async (unsaved) => {
        for (const cb of this.#afterMaking) await cb(unsaved as T);
      })) as T;
      for (const cb of this.#afterCreating) {
        await cb(model);
      }
      await this.#createRelated(model);
      items.push(model);
    }
    return (many ? items : items[0]!) as never;
  }

  /** `makeOne`. */
  async makeOne(attributes: FactoryAttributes = {}): Promise<T> {
    return (await this.make(attributes)) as T;
  }

  /** `createOne`. */
  async createOne(attributes: FactoryAttributes = {}): Promise<T> {
    return (await this.create(attributes)) as T;
  }

  /** `createMany(3)` or `createMany([{ name: "a" }, { name: "b" }])`. */
  async createMany(records: number | FactoryAttributes[]): Promise<T[]> {
    if (typeof records === "number") {
      return (await this.count(records).create()) as T[];
    }
    const out: T[] = [];
    for (const attrs of records) out.push((await this.createOne(attrs)) as T);
    return out;
  }

  /** `createQuietly` — no model events. */
  async createQuietly(
    attributes: FactoryAttributes = {},
  ): Promise<this extends ManyModels ? T[] : T> {
    return this.model().withoutEvents(() => this.create(attributes)) as never;
  }

  /** `createManyQuietly`. */
  async createManyQuietly(records: number | FactoryAttributes[]): Promise<T[]> {
    return this.model().withoutEvents(() => this.createMany(records)) as Promise<T[]>;
  }
}
