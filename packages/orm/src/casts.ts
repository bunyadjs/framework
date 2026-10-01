import { collect, Crypt, Fluent, type Collection } from "@bunyad/common";
import {
  dateForStorage,
  dateTimeForStorage,
  toDate,
  password as passwordPlatform,
  type DateInput,
  type DriverName,
} from "@bunyad/database";

/**
 * Attribute cast accessor/mutator (`Attribute.make`).
 */
export class Attribute {
  readonly get?: (
    value: unknown,
    attributes: Record<string, unknown>,
  ) => unknown;
  readonly set?: (
    value: unknown,
    attributes: Record<string, unknown>,
  ) => unknown | Record<string, unknown>;

  constructor(options: {
    get?: (
      value: unknown,
      attributes: Record<string, unknown>,
    ) => unknown;
    set?: (
      value: unknown,
      attributes: Record<string, unknown>,
    ) => unknown | Record<string, unknown>;
  }) {
    this.get = options.get;
    this.set = options.set;
  }

  /** `Attribute.make({ get, set })`. */
  static make(options: {
    get?: (
      value: unknown,
      attributes: Record<string, unknown>,
    ) => unknown;
    set?: (
      value: unknown,
      attributes: Record<string, unknown>,
    ) => unknown | Record<string, unknown>;
  }): Attribute {
    return new Attribute(options);
  }
}

/** Built-in cast type names. */
export type CastType =
  | "boolean"
  | "bool"
  | "number"
  | "integer"
  | "int"
  | "float"
  | "double"
  | "real"
  | "decimal"
  | "bigint"
  | "string"
  | "json"
  | "date"
  | "datetime"
  | "array"
  | "collection"
  | "encrypted"
  | "encrypted:array"
  | "encrypted:json"
  | "encrypted:collection"
  | "hashed";

/**
 * A TypeScript string/number enum object (or similar value map).
 */
export type EnumCast = Record<string, string | number>;

/** Anything accepted in `casts` / `casts()`. */
export type CastDefinition = CastType | EnumCast | Attribute;

const CAST_TYPE_SET = new Set<string>([
  "boolean",
  "bool",
  "number",
  "integer",
  "int",
  "float",
  "double",
  "real",
  "decimal",
  "bigint",
  "string",
  "json",
  "date",
  "datetime",
  "array",
  "collection",
  "encrypted",
  "encrypted:array",
  "encrypted:json",
  "encrypted:collection",
  "hashed",
]);

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value === "" || value === null || value === undefined) {
    return 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** JSON/sync often send `"0"` / `"false"`; those must not become true. */
function toBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === "1") {
    return true;
  }
  if (value === false || value === 0 || value === 0n || value === "0") {
    return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "false" ||
      normalized === "no" ||
      normalized === "off" ||
      normalized === ""
    ) {
      return false;
    }
    if (
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "on"
    ) {
      return true;
    }
  }
  return Boolean(value);
}

export function isCastType(value: unknown): value is CastType {
  return typeof value === "string" && CAST_TYPE_SET.has(value);
}

export function isAttribute(value: unknown): value is Attribute {
  return value instanceof Attribute;
}

export function isEnumCast(value: unknown): value is EnumCast {
  if (value == null || typeof value !== "object") return false;
  if (isAttribute(value) || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(
    ([, v]) => typeof v === "string" || typeof v === "number",
  );
}

function parseDateValue(value: unknown): Date {
  return toDate(value as DateInput);
}

/** Async bcrypt for the `hashed` cast (same output as the sync path, off the event loop). */
export function hashCastValue(value: string): Promise<string> {
  return passwordPlatform.hash(value, {
    algorithm: "bcrypt",
    cost: bcryptRounds(),
  });
}

/** Same cost as `Hash.make`: `BCRYPT_ROUNDS`, default 10. */
function bcryptRounds(): number {
  return Number(process.env.BCRYPT_ROUNDS ?? 10);
}

export function isAlreadyHashed(value: string): boolean {
  return value.startsWith("$2") || value.startsWith("$argon2");
}

function collectionItems(value: unknown): unknown[] {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as Collection).all === "function"
  ) {
    return (value as Collection).all();
  }
  return Array.isArray(value) ? value : [];
}

function encryptPayload(plain: unknown): string {
  const text = typeof plain === "string" ? plain : JSON.stringify(plain);
  return Crypt.encrypt(text);
}

function decryptPayload(value: unknown): string {
  if (typeof value !== "string") return String(value ?? "");
  return Crypt.decrypt(value);
}

export function castFromStorage(
  value: unknown,
  type: CastType,
): unknown {
  if (value == null) return value;
  switch (type) {
    case "boolean":
    case "bool":
      return toBoolean(value);
    case "number":
    case "float":
    case "double":
    case "real":
    case "decimal":
      return toNumber(value);
    case "integer":
    case "int":
      return Math.trunc(toNumber(value));
    case "bigint":
      return typeof value === "bigint" ? value : BigInt(String(value));
    case "string":
      return String(value);
    case "json":
    case "array":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "collection": {
      // From the database (JSON text), or already in memory: `fill()` passes a Collection or array.
      const parsed =
        typeof value === "string" ? JSON.parse(value) : value;
      return collect(collectionItems(parsed));
    }
    case "date":
    case "datetime":
      return parseDateValue(value);
    case "encrypted":
      return decryptPayload(value);
    case "encrypted:json":
    case "encrypted:array": {
      const plain = decryptPayload(value);
      return JSON.parse(plain);
    }
    case "encrypted:collection": {
      const plain = decryptPayload(value);
      const parsed = JSON.parse(plain);
      return collect(Array.isArray(parsed) ? parsed : []);
    }
    case "hashed":
      return value;
    default:
      return value;
  }
}

export function castToStorage(
  value: unknown,
  type: CastType,
  driver?: string,
): unknown {
  if (value == null) return value;
  const driverName = (driver ?? "sqlite") as DriverName;
  switch (type) {
    case "boolean":
    case "bool": {
      const flag = toBoolean(value);
      if (driverName === "postgres") return flag;
      return flag ? 1 : 0;
    }
    case "number":
    case "float":
    case "double":
    case "real":
    case "decimal":
      return toNumber(value);
    case "integer":
    case "int":
      return Math.trunc(toNumber(value));
    case "bigint":
      return typeof value === "bigint" ? value : BigInt(String(value));
    case "string":
      return String(value);
    case "json":
    case "array":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "collection": {
      const items = collectionItems(value);
      return JSON.stringify(items);
    }
    case "date":
      return dateForStorage(value as DateInput);
    case "datetime":
      return dateTimeForStorage(value as DateInput, driverName);
    case "encrypted":
      return encryptPayload(value);
    case "encrypted:json":
    case "encrypted:array":
      return encryptPayload(
        typeof value === "string" ? JSON.parse(value) : value,
      );
    case "encrypted:collection":
      return encryptPayload(collectionItems(value));
    case "hashed": {
      if (typeof value !== "string" || value === "") return value;
      // Match prior ORM behaviour: never double-hash `$2…` / `$argon2…`.
      if (isAlreadyHashed(value)) return value;
      return passwordPlatform.hashSync(value, {
        algorithm: "bcrypt",
        cost: bcryptRounds(),
      });
    }
    default:
      return value;
  }
}

export function enumFromStorage(value: unknown, enumObj: EnumCast): unknown {
  if (value == null) return value;
  for (const entry of Object.values(enumObj)) {
    if (entry == value || String(entry) === String(value)) return entry;
  }
  return value;
}

export function enumToStorage(value: unknown, enumObj: EnumCast): unknown {
  if (value == null) return value;
  for (const entry of Object.values(enumObj)) {
    if (entry === value) return entry;
  }
  if (typeof value === "string" && value in enumObj) {
    return enumObj[value];
  }
  return value;
}

/** Cast JSON column to a `Collection`. */
export const AsCollection = Attribute.make({
  get(value) {
    return castFromStorage(value, "collection");
  },
  set(value) {
    return castToStorage(value, "collection");
  },
});

/** Cast JSON column to a `Fluent` bag. */
export const AsFluent = Attribute.make({
  get(value) {
    if (value == null) return new Fluent();
    const parsed =
      typeof value === "string" ? JSON.parse(value) : value;
    return new Fluent(
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
    );
  },
  set(value) {
    if (value instanceof Fluent) return JSON.stringify(value.all());
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return JSON.stringify(value);
    }
    return JSON.stringify({});
  },
});

/**
 * Cast a JSON array to a Collection of enum values.
 *
 * ```ts
 * static casts() {
 *   return { statuses: AsEnumCollection.of(Status) };
 * }
 * ```
 */
export const AsEnumCollection = {
  of(enumObj: EnumCast): Attribute {
    return Attribute.make({
      get(value) {
        if (value == null) return collect([]);
        const parsed =
          typeof value === "string" ? JSON.parse(value) : value;
        const list = Array.isArray(parsed) ? parsed : [];
        return collect(list.map((item) => enumFromStorage(item, enumObj)));
      },
      set(value) {
        const items = collectionItems(value).map((item) =>
          enumToStorage(item, enumObj),
        );
        return JSON.stringify(items);
      },
    });
  },
};
