const SERIALIZES_MODELS = Symbol.for("bunyad.queue.serializesModels");

const MODEL_MARKER = "__bunyad_model__";

type ModelIdentifier = {
  [MODEL_MARKER]: true;
  class: string;
  key: string | number;
};

type JobCtor = Function & {
  [SERIALIZES_MODELS]?: boolean;
};

/** Duck-typed ORM model class used when restoring job payloads. */
export type SerializableModelClass = {
  name: string;
  primaryKey: string;
  find(id: string | number): Promise<object | null> | object | null;
};

type ModelLike = {
  getAttributes(): Record<string, unknown>;
  constructor: SerializableModelClass;
};

const modelRegistry = new Map<string, SerializableModelClass>();

/** Register a model class for job deserialization (by class name). */
export function registerSerializableModel(
  ModelClass: SerializableModelClass,
): void {
  modelRegistry.set(ModelClass.name, ModelClass);
}

export function clearSerializableModels(): void {
  modelRegistry.clear();
}

/**
 * When the queue driver serializes job payloads, ORM models become
 * `{ class, key }` and are re-fetched when the job runs.
 *
 * @example
 * ```ts
 * @SerializesModels()
 * class SendWelcome extends Job {
 *   constructor(public user: User) { super(); }
 *   async handle() { /* this.user is reloaded *\/ }
 * }
 * ```
 */
export function SerializesModels(): ClassDecorator {
  return (target) => {
    (target as JobCtor)[SERIALIZES_MODELS] = true;
  };
}

export function jobSerializesModels(job: object): boolean {
  return (job.constructor as JobCtor)[SERIALIZES_MODELS] === true;
}

function isModelLike(value: unknown): value is ModelLike {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as ModelLike).getAttributes === "function" &&
    typeof (value as ModelLike).constructor?.primaryKey === "string" &&
    typeof (value as ModelLike).constructor?.find === "function"
  );
}

function isModelIdentifier(value: unknown): value is ModelIdentifier {
  return (
    value != null &&
    typeof value === "object" &&
    (value as ModelIdentifier)[MODEL_MARKER] === true &&
    typeof (value as ModelIdentifier).class === "string"
  );
}

function serializeValue(value: unknown): unknown {
  if (isModelLike(value)) {
    const ctor = value.constructor;
    registerSerializableModel(ctor);
    const key = ctor.primaryKey;
    const attrs = value.getAttributes();
    return {
      [MODEL_MARKER]: true,
      class: ctor.name,
      key: attrs[key] as string | number,
    } satisfies ModelIdentifier;
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value != null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  return value;
}

async function restoreValue(value: unknown): Promise<unknown> {
  if (isModelIdentifier(value)) {
    const ModelClass = modelRegistry.get(value.class);
    if (!ModelClass) {
      throw new Error(
        `Serialized model [${value.class}] is not registered. Import the model class (or call registerSerializableModel) before working the queue.`,
      );
    }
    const model = await ModelClass.find(value.key);
    if (!model) {
      throw new Error(
        `No query results for model [${value.class}] ${value.key}.`,
      );
    }
    return model;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(restoreValue));
  }
  if (value != null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await restoreValue(v);
    }
    return out;
  }
  return value;
}

/** Serialize job public fields, optionally replacing models with identifiers. */
export function serializeJobFields(
  job: object,
  serializeModels: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const row = job as Record<string, unknown>;
  for (const key of Object.keys(job)) {
    const value = row[key];
    out[key] = serializeModels ? serializeValue(value) : value;
  }
  return out;
}

/** Restore model identifiers inside a deserialized job payload. */
export async function restoreJobFields(
  data: unknown,
  enabled: boolean,
): Promise<unknown> {
  if (!enabled) return data;
  return restoreValue(data);
}
