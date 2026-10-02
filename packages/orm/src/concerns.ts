import type { Model, ModelClass, ModelQuery } from "./model.ts";
import { morphMap } from "./model.ts";
import type { Factory } from "./factory.ts";

const HAS_UUIDS = Symbol.for("bunyad.orm.hasUuids");
const HAS_ULIDS = Symbol.for("bunyad.orm.hasUlids");
const PRUNABLE = Symbol.for("bunyad.orm.prunable");
const MASS_PRUNABLE = Symbol.for("bunyad.orm.massPrunable");

type ConcernModel = typeof Model & {
  [HAS_UUIDS]?: boolean;
  [HAS_ULIDS]?: boolean;
  [PRUNABLE]?: boolean;
  [MASS_PRUNABLE]?: boolean;
  incrementing?: boolean;
  keyType?: "int" | "string";
  softDeletes?: boolean;
  deletedAt?: string;
  factory?: () => Factory<any>;
  newUniqueId?: () => string;
  uniqueIds?: () => string[];
  prunable?: () => ModelQuery | Promise<ModelQuery>;
  pruning?: (model: Model) => void | Promise<void>;
};

const prunableModels = new Set<ModelClass>();
const massPrunableModels = new Set<ModelClass>();

/** Crockford Base32 alphabet (ULID). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Generate a UUIDv7 (time-ordered) string. */
export function uuid7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Generate a 26-character ULID. */
export function ulid(now = Date.now()): string {
  let time = now;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[time % 32]! + out;
    time = Math.floor(time / 32);
  }
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  for (let i = 0; i < 16; i++) {
    out += CROCKFORD[rand[i]! % 32]!;
  }
  return out;
}

function asConcern(target: Function): ConcernModel {
  return target as ConcernModel;
}

function assignUniqueIds(model: Model, ctor: ConcernModel): void {
  const keys = ctor.uniqueIds?.() ?? [ctor.primaryKey];
  const row = model as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] == null || row[key] === "") {
      row[key] = ctor.newUniqueId?.() ?? uuid7();
    }
  }
}

/**
 * Ordered UUID primary keys (`incrementing = false`).
 *
 * @example
 * ```ts
 * @HasUuids()
 * class Article extends Model {}
 * ```
 */
export function HasUuids(): ClassDecorator {
  return (target) => {
    const ctor = asConcern(target);
    ctor[HAS_UUIDS] = true;
    ctor.incrementing = false;
    ctor.keyType = "string";
    ctor.newUniqueId = () => uuid7();
    ctor.uniqueIds = () => [ctor.primaryKey];
    morphMap({ [ctor.name]: ctor as unknown as ModelClass });
    ctor.creating((model) => assignUniqueIds(model, ctor));
  };
}

/**
 * ULID primary keys (`incrementing = false`).
 */
export function HasUlids(): ClassDecorator {
  return (target) => {
    const ctor = asConcern(target);
    ctor[HAS_ULIDS] = true;
    ctor.incrementing = false;
    ctor.keyType = "string";
    ctor.newUniqueId = () => ulid();
    ctor.uniqueIds = () => [ctor.primaryKey];
    morphMap({ [ctor.name]: ctor as unknown as ModelClass });
    ctor.creating((model) => assignUniqueIds(model, ctor));
  };
}

type FactoryClass = new () => Factory<any>;
type FactoryResolver = FactoryClass | (() => Factory<any>);

function resolveFactory(factory: FactoryResolver): Factory<any> {
  if (
    typeof factory === "function" &&
    factory.prototype != null &&
    typeof (factory.prototype as { model?: unknown }).model === "function"
  ) {
    return new (factory as FactoryClass)();
  }
  return (factory as () => Factory<any>)();
}

/**
 * Bind a factory class and expose `Model.factory()`.
 *
 * @example
 * ```ts
 * @HasFactory(UserFactory)
 * // or @HasFactory(() => new UserFactory())
 * class User extends Model {}
 * User.factory().create();
 * ```
 */
export function HasFactory(factory: FactoryResolver): ClassDecorator {
  return (target) => {
    const ctor = asConcern(target);
    ctor.factory = () => resolveFactory(factory);
  };
}

/**
 * Soft deletes — sets `static softDeletes = true`.
 * Prefer this decorator for `use SoftDeletes`-style call sites.
 */
export function SoftDeletes(column = "deleted_at"): ClassDecorator {
  return (target) => {
    const ctor = asConcern(target);
    ctor.softDeletes = true;
    ctor.deletedAt = column;
  };
}

type PrunableModelClass = ModelClass & {
  prunable(): ModelQuery | Promise<ModelQuery>;
  pruning?(model: Model): void | Promise<void>;
};

/**
 * Register for `model:prune` / `pruneAll()`.
 * Define `static prunable()` returning the query of models to delete.
 */
export function Prunable(): ClassDecorator {
  return (target) => {
    const ctor = asConcern(target);
    ctor[PRUNABLE] = true;
    prunableModels.add(ctor as unknown as ModelClass);
  };
}

/**
 * Mass-delete via query (no model hydration / events).
 */
export function MassPrunable(): ClassDecorator {
  return (target) => {
    const ctor = asConcern(target);
    ctor[MASS_PRUNABLE] = true;
    massPrunableModels.add(ctor as unknown as ModelClass);
  };
}

export function prunableModelClasses(): ModelClass[] {
  return [...prunableModels];
}

export function massPrunableModelClasses(): ModelClass[] {
  return [...massPrunableModels];
}

/** Clear registries (tests). */
export function clearPrunableRegistries(): void {
  prunableModels.clear();
  massPrunableModels.clear();
}

async function pruneOne(
  ModelClass: ModelClass,
  options: { chunk?: number; mass?: boolean } = {},
): Promise<number> {
  const ctor = ModelClass as unknown as PrunableModelClass;
  if (typeof ctor.prunable !== "function") {
    throw new Error(
      `Model [${ModelClass.name}] is prunable but does not define static prunable().`,
    );
  }

  const chunk = options.chunk ?? 1000;
  let total = 0;

  if (options.mass || (ModelClass as ConcernModel)[MASS_PRUNABLE]) {
    const query = await ctor.prunable();
    if ((ModelClass as ConcernModel).softDeletes) {
      total += await query.forceDelete();
    } else {
      total += await query.delete();
    }
    return total;
  }

  for (;;) {
    const query = await ctor.prunable();
    const models = await query.limit(chunk).get();
    if (models.isEmpty()) break;
    for (const model of models) {
      await ctor.pruning?.(model);
      if ((ModelClass as ConcernModel).softDeletes) {
        await model.forceDelete();
      } else {
        await model.delete();
      }
      total += 1;
    }
    if (models.length < chunk) break;
  }
  return total;
}

/** Prune one model class (`Model::pruneAll` for a single class). */
export async function prune(
  ModelClass: ModelClass,
  options: { chunk?: number } = {},
): Promise<number> {
  return pruneOne(ModelClass, options);
}

/** Prune every registered `@Prunable` / `@MassPrunable` model. */
export async function pruneAll(
  options: { chunk?: number } = {},
): Promise<Array<{ model: string; count: number }>> {
  const results: Array<{ model: string; count: number }> = [];
  for (const ModelClass of massPrunableModels) {
    results.push({
      model: ModelClass.name,
      count: await pruneOne(ModelClass, { ...options, mass: true }),
    });
  }
  for (const ModelClass of prunableModels) {
    if (massPrunableModels.has(ModelClass)) continue;
    results.push({
      model: ModelClass.name,
      count: await pruneOne(ModelClass, options),
    });
  }
  return results;
}
