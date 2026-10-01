import { BunyadError, dataGet } from "@bunyad/common";
import {
  Password,
  getCurrentPasswordVerifier,
} from "./password-rule.ts";
import { Can, CanAny } from "./can-rule.ts";
import defaultValidationMessages from "./lang/en/validation.ts";

export type MessageTemplate =
  | string
  | ((field: string, params: string[]) => string);

/**
 * Custom rule object (`ValidationRule` / `Rule` class).
 */
export type ValidationRule = {
  passes(
    attribute: string,
    value: unknown,
    data: Record<string, unknown>,
    context?: { user?: unknown },
  ): boolean | Promise<boolean>;
  message(): string;
};

export type RuleItem =
  | string
  | ValidationRule
  | DatabaseRule
  | ConditionalRules
  | ExcludeRules;
export type FieldRules = string | RuleItem | RuleItem[];
export type Rules = Record<string, FieldRules>;

export class ValidationException extends BunyadError {
  /** Named bag the errors are flashed under (`default` is the plain `errors`). */
  errorBag = "default";

  constructor(readonly errors: Record<string, string[]>) {
    super("The given data was invalid.", "BUNYAD_VALIDATION_001");
    this.name = "ValidationException";
  }

  /** Flash the errors under a named bag (`@error('field', 'bag')`). */
  withErrorBag(name: string): this {
    this.errorBag = name;
    return this;
  }

  /** Laravel `ValidationException::withMessages` (`{ email: "Bad" }` or `{ email: ["Bad"] }`). */
  static withMessages(
    messages: Record<string, string | string[]>,
  ): ValidationException {
    const errors: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(messages)) {
      errors[key] = Array.isArray(value) ? value : [value];
    }
    return new ValidationException(errors);
  }
}

/**
 * Error message bag (Laravel `MessageBag`).
 */
export class MessageBag {
  readonly #messages: Record<string, string[]>;

  constructor(messages: Record<string, string[]> = {}) {
    this.#messages = messages;
  }

  messages(): Record<string, string[]> {
    return { ...this.#messages };
  }

  all(): string[] {
    return Object.values(this.#messages).flat();
  }

  first(key?: string): string | null {
    if (key) return this.#messages[key]?.[0] ?? null;
    const firstKey = Object.keys(this.#messages)[0];
    return firstKey ? (this.#messages[firstKey]?.[0] ?? null) : null;
  }

  get(key: string): string[] {
    return this.#messages[key] ?? [];
  }

  has(key: string): boolean {
    return (this.#messages[key]?.length ?? 0) > 0;
  }

  any(): boolean {
    return this.all().length > 0;
  }

  isEmpty(): boolean {
    return !this.any();
  }

  isNotEmpty(): boolean {
    return this.any();
  }

  keys(): string[] {
    return Object.keys(this.#messages);
  }

  add(key: string, message: string): this {
    if (!this.#messages[key]) this.#messages[key] = [];
    this.#messages[key]!.push(message);
    return this;
  }
}

/** Extra WHERE clause for unique/exists (equality or IS NULL). */
export type PresenceWhere = {
  column: string;
  value: unknown;
  /** `null` → `column IS NULL`; default equality. */
  operator?: "eq" | "null";
};

/** Query builder passed to `Rule.unique().where(fn)`. */
export type DatabaseWhereQuery = {
  where(column: string, value: unknown): DatabaseWhereQuery;
  whereNull(column: string): DatabaseWhereQuery;
};

/** Fluent unique/exists rule builder. */
export class DatabaseRule {
  #exceptId: string | number | null = null;
  #exceptColumn = "id";
  #wheres: PresenceWhere[] = [];

  constructor(
    readonly kind: "unique" | "exists",
    readonly table: string,
    readonly column: string,
  ) {}

  ignore(id: string | number | null, idColumn = "id"): this {
    this.#exceptId = id;
    this.#exceptColumn = idColumn;
    return this;
  }

  /**
   * Extra WHERE clauses — equality (`where('col', value)`) or a callback
   * (`where((q) => q.where('a', 1).whereNull('b'))`).
   */
  where(
    columnOrFn: string | ((query: DatabaseWhereQuery) => void),
    value?: unknown,
  ): this {
    if (typeof columnOrFn === "function") {
      const query: DatabaseWhereQuery = {
        where: (column, v) => {
          this.#wheres.push({ column, value: v, operator: "eq" });
          return query;
        },
        whereNull: (column) => {
          this.#wheres.push({ column, value: null, operator: "null" });
          return query;
        },
      };
      columnOrFn(query);
      return this;
    }
    this.#wheres.push({ column: columnOrFn, value, operator: "eq" });
    return this;
  }

  /** Extra `column IS NULL` constraint. */
  whereNull(column: string): this {
    this.#wheres.push({ column, value: null, operator: "null" });
    return this;
  }

  /** Snapshot of extra WHERE clauses for the presence verifier. */
  getWheres(): PresenceWhere[] {
    return this.#wheres.map((w) => ({ ...w }));
  }

  except(): { column: string; value: unknown } | undefined {
    if (this.#exceptId == null) return undefined;
    return { column: this.#exceptColumn, value: this.#exceptId };
  }

  toString(): string {
    const col = this.column === "NULL" ? "" : this.column;
    if (this.kind === "unique" && this.#exceptId != null) {
      return `unique:${this.table},${col || "NULL"},${this.#exceptId},${this.#exceptColumn}`;
    }
    if (col) return `${this.kind}:${this.table},${col}`;
    return `${this.kind}:${this.table}`;
  }
}

export type ConditionalRules = {
  __conditional: true;
  condition: boolean | (() => boolean | Promise<boolean>);
  rules: FieldRules;
  defaultRules?: FieldRules;
};

/** Conditionally exclude an attribute from validation / validated data. */
export type ExcludeRules = {
  __exclude: true;
  condition: boolean | (() => boolean | Promise<boolean>);
};

type ReplacerFn = (
  message: string,
  attribute: string,
  rule: string,
  parameters: string[],
) => string;

const customReplacers: Record<string, ReplacerFn> = {};

/**
 * DB presence checks for `unique` / `exists` rules.
 */
export type PresenceVerifier = {
  exists(
    table: string,
    column: string,
    value: unknown,
    except?: { column: string; value: unknown },
    wheres?: PresenceWhere[],
  ): boolean | Promise<boolean>;
};

let presenceVerifier: PresenceVerifier | undefined;

export function setPresenceVerifier(verifier: PresenceVerifier | undefined): void {
  presenceVerifier = verifier;
}

export function getPresenceVerifier(): PresenceVerifier | undefined {
  return presenceVerifier;
}

/** Hostname reachability for `active_url` (overridable in tests). */
export type ActiveUrlChecker = (host: string) => boolean | Promise<boolean>;

let activeUrlChecker: ActiveUrlChecker | undefined;

export function setActiveUrlChecker(
  checker: ActiveUrlChecker | undefined,
): void {
  activeUrlChecker = checker;
}

export function getActiveUrlChecker(): ActiveUrlChecker | undefined {
  return activeUrlChecker;
}

async function defaultActiveUrlCheck(host: string): Promise<boolean> {
  try {
    const dns = await import("node:dns/promises");
    await dns.lookup(host);
    return true;
  } catch {
    return false;
  }
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Build a verifier from a Connection-like object (LIMIT 1 — hot-form friendly). */
export function presenceVerifierFor(connection: {
  get(
    sql: string,
    params?: unknown[],
  ):
    | Record<string, unknown>
    | null
    | Promise<Record<string, unknown> | null>;
}): PresenceVerifier {
  return {
    async exists(table, column, value, except, wheres) {
      if (!IDENT.test(table) || !IDENT.test(column)) {
        throw new Error(
          `Invalid unique/exists identifier [${table}.${column}].`,
        );
      }
      // Prefer existence probe over COUNT(*) on hot forms.
      let sql = `SELECT 1 as c FROM ${table} WHERE ${column} = ?`;
      const params: unknown[] = [value];
      if (except) {
        if (!IDENT.test(except.column)) {
          throw new Error(`Invalid except column [${except.column}].`);
        }
        sql += ` AND ${except.column} != ?`;
        params.push(except.value);
      }
      if (wheres) {
        for (const w of wheres) {
          if (!IDENT.test(w.column)) {
            throw new Error(`Invalid where column [${w.column}].`);
          }
          if (w.operator === "null") {
            sql += ` AND ${w.column} IS NULL`;
          } else {
            sql += ` AND ${w.column} = ?`;
            params.push(w.value);
          }
        }
      }
      sql += " LIMIT 1";
      const row = await connection.get(sql, params);
      return row != null;
    },
  };
}


async function checkPresence(
  kind: "unique" | "exists",
  value: unknown,
  table: string | undefined,
  column: string,
  except?: { column: string; value: unknown },
  wheres?: PresenceWhere[],
): Promise<string | undefined> {
  if (isEmpty(value)) return;
  if (!presenceVerifier) return;
  if (!table) return kind;
  const found = await presenceVerifier.exists(
    table,
    column,
    value,
    except,
    wheres,
  );
  if (kind === "unique" && found) return "unique";
  if (kind === "exists" && !found) return "exists";
}

type RuleContext = {
  /** Field has `numeric` or `integer` (Laravel size uses the number). */
  hasNumeric: boolean;
  /** Authenticated user for `current_password` (from ValidateOptions). */
  user?: { password?: string } | null;
};

type RuleFn = (
  value: unknown,
  params: string[],
  field: string,
  data: Record<string, unknown>,
  context: RuleContext,
) => string | undefined | Promise<string | undefined>;

function isEmpty(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Trim strings and turn blank strings into null before rules run. */
function normalizeInput(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (Array.isArray(value)) {
    return value.map(normalizeInput);
  }
  if (isUploadedFile(value) || value instanceof Date) {
    return value;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = normalizeInput(nested);
    }
    return out;
  }
  return value;
}

function namedRuleNames(parsedRules: ParsedRule[]): Set<string> {
  const names = new Set<string>();
  for (const rule of parsedRules) {
    if (rule.kind === "named") {
      names.add(rule.name);
    }
  }
  return names;
}

/** Cast a passing value to the type implied by its rules. */
function coerceValidated(
  value: unknown,
  parsedRules: ParsedRule[],
): unknown {
  if (value === undefined) {
    return value;
  }
  const names = namedRuleNames(parsedRules);
  if (value === null || (names.has("nullable") && isEmpty(value))) {
    return null;
  }
  if (names.has("boolean")) {
    return (
      value === true ||
      value === 1 ||
      value === "1" ||
      value === "true" ||
      value === "on" ||
      value === "yes"
    );
  }
  if (names.has("integer")) {
    if (typeof value === "number" && Number.isInteger(value)) {
      return value;
    }
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : value;
  }
  if (names.has("numeric")) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (names.has("string")) {
    return String(value);
  }
  return value;
}

function isUploadedFile(value: unknown): value is {
  size: number;
  mimeType?: string;
  clientOriginalExtension?: () => string;
  isValid?: () => boolean;
} {
  return (
    value != null &&
    typeof value === "object" &&
    "size" in value &&
    typeof (value as { size: unknown }).size === "number" &&
    "getClientOriginalName" in value
  );
}

function isNumericString(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value.trim());
}

/** Parse `3/2` or `1.5` style ratios. */
function parseRatio(raw: string): number | null {
  if (raw.includes("/")) {
    const [a, b] = raw.split("/");
    const num = Number(a);
    const den = Number(b);
    if (!num || !den) return null;
    return num / den;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Laravel `Validator::getSize` — strings by length, numeric by value, files by KB. */
function sizeForMinMax(value: unknown, context: RuleContext): number | undefined {
  if (isUploadedFile(value)) return Math.ceil(value.size / 1024);
  if (Array.isArray(value)) return value.length;
  if (
    context.hasNumeric &&
    (typeof value === "number" ||
      (typeof value === "string" && isNumericString(value)))
  ) {
    return Number(value);
  }
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.length;
  return undefined;
}

const ACCEPTED_VALUES = new Set(["yes", "on", "1", "true", 1, true]);
const DECLINED_VALUES = new Set(["no", "off", "0", "false", 0, false]);

function isAccepted(value: unknown): boolean {
  if (typeof value === "string") return ACCEPTED_VALUES.has(value.toLowerCase());
  return ACCEPTED_VALUES.has(value as string | number | boolean);
}

function isDeclined(value: unknown): boolean {
  if (typeof value === "string") return DECLINED_VALUES.has(value.toLowerCase());
  return DECLINED_VALUES.has(value as string | number | boolean);
}

function parseDateValue(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Resolve `after:field` / `after:2020-01-01` to a Date. */
function resolveDateParam(
  param: string | undefined,
  data: Record<string, unknown>,
): Date | null {
  if (!param) return null;
  if (dataHas(data, param)) return parseDateValue(dataGet(data, param));
  return parseDateValue(param);
}

/**
 * Match a value against a date format using tokens such as `Y-m-d` and `Y-m-d H:i:s`.
 */
function matchesDateFormat(value: string, format: string): boolean {
  let vi = 0;
  for (let fi = 0; fi < format.length; fi++) {
    const token = format[fi]!;
    const next = () => value[vi++];
    switch (token) {
      case "Y": {
        const y = value.slice(vi, vi + 4);
        if (!/^\d{4}$/.test(y)) return false;
        vi += 4;
        break;
      }
      case "y": {
        if (!/^\d{2}$/.test(value.slice(vi, vi + 2))) return false;
        vi += 2;
        break;
      }
      case "m":
      case "d":
      case "H":
      case "i":
      case "s": {
        if (!/^\d{2}$/.test(value.slice(vi, vi + 2))) return false;
        vi += 2;
        break;
      }
      case "n":
      case "j":
      case "G": {
        const m = value.slice(vi).match(/^\d{1,2}/);
        if (!m) return false;
        vi += m[0]!.length;
        break;
      }
      case "a":
      case "A": {
        if (!/^(am|pm)$/i.test(value.slice(vi, vi + 2))) return false;
        vi += 2;
        break;
      }
      default:
        if (next() !== token) return false;
    }
  }
  return vi === value.length;
}

function compareSizes(
  value: unknown,
  otherRaw: unknown,
  params: string[],
  data: Record<string, unknown>,
  context: RuleContext,
  op: "gt" | "gte" | "lt" | "lte",
): boolean {
  const otherParam = params[0];
  if (!otherParam) return false;
  const other = dataHas(data, otherParam)
    ? dataGet(data, otherParam)
    : otherParam;
  const left = sizeForMinMax(value, context);
  const otherContext: RuleContext = {
    ...context,
    hasNumeric:
      context.hasNumeric ||
      typeof other === "number" ||
      (typeof other === "string" && isNumericString(other)),
  };
  const right =
    typeof other === "number" ||
    (typeof other === "string" && isNumericString(other))
      ? Number(other)
      : sizeForMinMax(other, otherContext);
  if (left === undefined || right === undefined) return false;
  if (op === "gt") return left > right;
  if (op === "gte") return left >= right;
  if (op === "lt") return left < right;
  return left <= right;
}

const rules: Record<string, RuleFn> = {
  required(value) {
    if (isEmpty(value)) return "required";
  },
  /** Laravel `nullable` — empty values skip remaining rules (handled in runner). */
  nullable() {
    return undefined;
  },
  email(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "email";
    }
  },
  string(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "string";
  },
  numeric(value) {
    if (isEmpty(value)) return;
    if (
      typeof value !== "number" &&
      (typeof value !== "string" || Number.isNaN(Number(value)))
    ) {
      return "numeric";
    }
  },
  integer(value) {
    if (isEmpty(value)) return;
    if (typeof value === "number") {
      if (!Number.isInteger(value)) return "integer";
      return;
    }
    if (typeof value !== "string" || !/^-?\d+$/.test(value)) return "integer";
  },
  boolean(value) {
    if (isEmpty(value)) return;
    // Checkbox-style values: on/off, yes/no, 1/0, true/false.
    const ok =
      value === true ||
      value === false ||
      value === 0 ||
      value === 1 ||
      value === "0" ||
      value === "1" ||
      value === "true" ||
      value === "false" ||
      value === "on" ||
      value === "off" ||
      value === "yes" ||
      value === "no";
    if (!ok) return "boolean";
  },
  array(value) {
    if (isEmpty(value)) return;
    if (!Array.isArray(value)) return "array";
  },
  date(value) {
    if (isEmpty(value)) return;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return "date";
      return;
    }
    if (typeof value !== "string" && typeof value !== "number") return "date";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "date";
  },
  accepted(value) {
    if (!isAccepted(value)) return "accepted";
  },
  declined(value) {
    if (!isDeclined(value)) return "declined";
  },
  accepted_if(value, params, _field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (
      expected.map(String).includes(String(otherVal)) &&
      !isAccepted(value)
    ) {
      return "accepted_if";
    }
  },
  declined_if(value, params, _field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (
      expected.map(String).includes(String(otherVal)) &&
      !isDeclined(value)
    ) {
      return "declined_if";
    }
  },
  after(value, params, _field, data) {
    if (isEmpty(value)) return;
    const left = parseDateValue(value);
    const right = resolveDateParam(params[0], data);
    if (!left || !right || !(left.getTime() > right.getTime())) return "after";
  },
  after_or_equal(value, params, _field, data) {
    if (isEmpty(value)) return;
    const left = parseDateValue(value);
    const right = resolveDateParam(params[0], data);
    if (!left || !right || left.getTime() < right.getTime()) {
      return "after_or_equal";
    }
  },
  before(value, params, _field, data) {
    if (isEmpty(value)) return;
    const left = parseDateValue(value);
    const right = resolveDateParam(params[0], data);
    if (!left || !right || !(left.getTime() < right.getTime())) return "before";
  },
  before_or_equal(value, params, _field, data) {
    if (isEmpty(value)) return;
    const left = parseDateValue(value);
    const right = resolveDateParam(params[0], data);
    if (!left || !right || left.getTime() > right.getTime()) {
      return "before_or_equal";
    }
  },
  date_equals(value, params, _field, data) {
    if (isEmpty(value)) return;
    const left = parseDateValue(value);
    const right = resolveDateParam(params[0], data);
    if (!left || !right || left.getTime() !== right.getTime()) {
      return "date_equals";
    }
  },
  date_format(value, params) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "date_format";
    const format = params[0];
    if (!format || !matchesDateFormat(value, format)) return "date_format";
  },
  gt(value, params, _field, data, context) {
    if (isEmpty(value)) return;
    if (!compareSizes(value, undefined, params, data, context, "gt")) {
      return "gt";
    }
  },
  gte(value, params, _field, data, context) {
    if (isEmpty(value)) return;
    if (!compareSizes(value, undefined, params, data, context, "gte")) {
      return "gte";
    }
  },
  lt(value, params, _field, data, context) {
    if (isEmpty(value)) return;
    if (!compareSizes(value, undefined, params, data, context, "lt")) {
      return "lt";
    }
  },
  lte(value, params, _field, data, context) {
    if (isEmpty(value)) return;
    if (!compareSizes(value, undefined, params, data, context, "lte")) {
      return "lte";
    }
  },
  url(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "url";
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "url";
    } catch {
      return "url";
    }
  },
  min(value, params, _field, _data, context) {
    if (isEmpty(value)) return;
    const min = Number(params[0]);
    const size = sizeForMinMax(value, context);
    if (size === undefined || size < min) return "min";
  },
  max(value, params, _field, _data, context) {
    if (isEmpty(value)) return;
    const max = Number(params[0]);
    const size = sizeForMinMax(value, context);
    if (size === undefined || size > max) return "max";
  },
  between(value, params, _field, _data, context) {
    if (isEmpty(value)) return;
    const min = Number(params[0]);
    const max = Number(params[1]);
    const size = sizeForMinMax(value, context);
    if (size === undefined || size < min || size > max) return "between";
  },
  /** Laravel `confirmed` — field must match `{field}_confirmation`. */
  confirmed(value, _params, field, data) {
    if (isEmpty(value)) return;
    if (dataGet(data, confirmationAttribute(field)) !== value) return "confirmed";
  },
  /** Laravel `current_password` / `current_password:guard`. */
  async current_password(value, params, _field, _data, context) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "current_password";
    const verifier = getCurrentPasswordVerifier();
    if (!verifier) return "current_password";
    const ok = await verifier(value, params[0], context.user);
    if (!ok) return "current_password";
  },
  /** Laravel `same:other`. */
  same(value, params, _field, data) {
    if (isEmpty(value)) return;
    const other = params[0];
    if (!other || dataGet(data, other) !== value) return "same";
  },
  /** Laravel `different:other`. */
  different(value, params, _field, data) {
    if (isEmpty(value)) return;
    const other = params[0];
    if (!other || dataGet(data, other) === value) return "different";
  },
  /** Laravel `in:a,b,c`. */
  in(value, params) {
    if (isEmpty(value)) return;
    if (!params.map(String).includes(String(value))) return "in";
  },
  /** Laravel `not_in:a,b,c`. */
  not_in(value, params) {
    if (isEmpty(value)) return;
    if (params.map(String).includes(String(value))) return "not_in";
  },
  size(value, params, _field, _data, context) {
    if (isEmpty(value)) return;
    const expected = Number(params[0]);
    const size = sizeForMinMax(value, context);
    if (size === undefined || size !== expected) return "size";
  },
  filled(value) {
    if (isEmpty(value)) return "filled";
  },
  present(_value, _params, field, data) {
    if (!dataHas(data, field)) return "present";
  },
  missing(_value, _params, field, data) {
    if (dataHas(data, field)) return "missing";
  },
  prohibited(value) {
    if (!isEmpty(value)) return "prohibited";
  },
  alpha(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || !/^[a-zA-Z]+$/.test(value)) return "alpha";
  },
  alpha_num(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || !/^[a-zA-Z0-9]+$/.test(value)) {
      return "alpha_num";
    }
  },
  alpha_dash(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) {
      return "alpha_dash";
    }
  },
  /** Laravel `ascii` — 7-bit ASCII only. */
  ascii(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "ascii";
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 127) return "ascii";
    }
  },
  /** Laravel `lowercase`. */
  lowercase(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || value !== value.toLowerCase()) {
      return "lowercase";
    }
  },
  /** Laravel `uppercase`. */
  uppercase(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || value !== value.toUpperCase()) {
      return "uppercase";
    }
  },
  uuid(value) {
    if (isEmpty(value)) return;
    if (
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    ) {
      return "uuid";
    }
  },
  ulid(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value)) {
      return "ulid";
    }
  },
  ip(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "ip";
    const v4 =
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) &&
      value.split(".").every((p) => Number(p) <= 255);
    const v6 = /^[0-9a-f:]+$/i.test(value) && value.includes(":");
    if (!v4 && !v6) return "ip";
  },
  ipv4(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "ipv4";
    if (
      !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) ||
      value.split(".").some((p) => Number(p) > 255)
    ) {
      return "ipv4";
    }
  },
  ipv6(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string" || !value.includes(":")) return "ipv6";
  },
  json(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "json";
    try {
      JSON.parse(value);
    } catch {
      return "json";
    }
  },
  contains(value, params) {
    if (isEmpty(value)) return;
    if (!Array.isArray(value)) return "contains";
    for (const p of params) {
      if (!value.map(String).includes(String(p))) return "contains";
    }
  },
  doesnt_contain(value, params) {
    if (isEmpty(value)) return;
    if (!Array.isArray(value)) return;
    for (const p of params) {
      if (value.map(String).includes(String(p))) return "doesnt_contain";
    }
  },
  not_regex(value, params) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "not_regex";
    const raw = params.join(",");
    let pattern = raw;
    let flags = "";
    if (raw.startsWith("/") && raw.lastIndexOf("/") > 0) {
      const end = raw.lastIndexOf("/");
      pattern = raw.slice(1, end);
      flags = raw.slice(end + 1);
    }
    try {
      if (new RegExp(pattern, flags).test(value)) return "not_regex";
    } catch {
      return "not_regex";
    }
  },
  required_if(value, params, _field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (expected.map(String).includes(String(otherVal)) && isEmpty(value)) {
      return "required";
    }
  },
  required_unless(value, params, _field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (!expected.map(String).includes(String(otherVal)) && isEmpty(value)) {
      return "required";
    }
  },
  required_with(value, params, _field, data) {
    if (params.some((p) => !isEmpty(dataGet(data, p))) && isEmpty(value)) {
      return "required";
    }
  },
  required_without(value, params, _field, data) {
    if (params.some((p) => isEmpty(dataGet(data, p))) && isEmpty(value)) {
      return "required";
    }
  },
  required_with_all(value, params, _field, data) {
    if (params.every((p) => !isEmpty(dataGet(data, p))) && isEmpty(value)) {
      return "required";
    }
  },
  required_without_all(value, params, _field, data) {
    if (params.every((p) => isEmpty(dataGet(data, p))) && isEmpty(value)) {
      return "required";
    }
  },
  prohibited_if(value, params, _field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (expected.map(String).includes(String(otherVal)) && !isEmpty(value)) {
      return "prohibited";
    }
  },
  prohibited_unless(value, params, _field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (!expected.map(String).includes(String(otherVal)) && !isEmpty(value)) {
      return "prohibited";
    }
  },
  prohibits(value, params, _field, data) {
    if (isEmpty(value)) return;
    for (const other of params) {
      if (!isEmpty(dataGet(data, other))) return "prohibits";
    }
  },
  present_if(_value, params, field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (
      expected.map(String).includes(String(otherVal)) &&
      !dataHas(data, field)
    ) {
      return "present";
    }
  },
  present_unless(_value, params, field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (
      !expected.map(String).includes(String(otherVal)) &&
      !dataHas(data, field)
    ) {
      return "present";
    }
  },
  present_with(_value, params, field, data) {
    if (params.some((p) => dataHas(data, p)) && !dataHas(data, field)) {
      return "present";
    }
  },
  present_with_all(_value, params, field, data) {
    if (params.every((p) => dataHas(data, p)) && !dataHas(data, field)) {
      return "present";
    }
  },
  missing_if(_value, params, field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (
      expected.map(String).includes(String(otherVal)) &&
      dataHas(data, field)
    ) {
      return "missing";
    }
  },
  missing_unless(_value, params, field, data) {
    const other = params[0];
    if (!other) return;
    const expected = params.slice(1);
    const otherVal = dataGet(data, other);
    if (
      !expected.map(String).includes(String(otherVal)) &&
      dataHas(data, field)
    ) {
      return "missing";
    }
  },
  missing_with(_value, params, field, data) {
    if (params.some((p) => dataHas(data, p)) && dataHas(data, field)) {
      return "missing";
    }
  },
  missing_with_all(_value, params, field, data) {
    if (params.every((p) => dataHas(data, p)) && dataHas(data, field)) {
      return "missing";
    }
  },
  digits(value, params) {
    if (isEmpty(value)) return;
    const len = Number(params[0]);
    const s = String(value);
    if (!/^\d+$/.test(s) || s.length !== len) return "digits";
  },
  digits_between(value, params) {
    if (isEmpty(value)) return;
    const min = Number(params[0]);
    const max = Number(params[1]);
    const s = String(value);
    if (!/^\d+$/.test(s) || s.length < min || s.length > max) {
      return "digits_between";
    }
  },
  decimal(value, params) {
    if (isEmpty(value)) return;
    const s = String(value);
    if (!/^-?\d+(\.\d+)?$/.test(s)) return "decimal";
    const minPlaces = Number(params[0] ?? 0);
    const maxPlaces =
      params[1] !== undefined ? Number(params[1]) : minPlaces;
    const dot = s.indexOf(".");
    const places = dot === -1 ? 0 : s.length - dot - 1;
    if (places < minPlaces || places > maxPlaces) return "decimal";
  },
  multiple_of(value, params) {
    if (isEmpty(value)) return;
    const n = Number(value);
    const factor = Number(params[0]);
    if (!Number.isFinite(n) || !Number.isFinite(factor) || factor === 0) {
      return "multiple_of";
    }
    // Avoid float remainder pitfalls for common decimals.
    const scaled = Math.round((n / factor) * 1e12) / 1e12;
    if (!Number.isInteger(scaled)) return "multiple_of";
  },
  starts_with(value, params) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "starts_with";
    if (!params.some((p) => value.startsWith(p))) return "starts_with";
  },
  ends_with(value, params) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "ends_with";
    if (!params.some((p) => value.endsWith(p))) return "ends_with";
  },
  doesnt_start_with(value, params) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return;
    if (params.some((p) => value.startsWith(p))) return "doesnt_start_with";
  },
  doesnt_end_with(value, params) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return;
    if (params.some((p) => value.endsWith(p))) return "doesnt_end_with";
  },
  hex_color(value) {
    if (isEmpty(value)) return;
    if (
      typeof value !== "string" ||
      !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
    ) {
      return "hex_color";
    }
  },
  mac_address(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "mac_address";
    const hex = value.replace(/[:\-.]/g, "");
    if (!/^[0-9a-f]{12}$/i.test(hex)) return "mac_address";
    // Reject mixed separators / malformed groups when separators are present.
    if (/[:\-.]/.test(value)) {
      const parts = value.split(/[:\-.]/);
      if (
        !(
          (parts.length === 6 && parts.every((p) => /^[0-9a-f]{2}$/i.test(p))) ||
          (parts.length === 3 && parts.every((p) => /^[0-9a-f]{4}$/i.test(p)))
        )
      ) {
        return "mac_address";
      }
    }
  },
  timezone(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "timezone";
    try {
      const zones =
        typeof Intl !== "undefined" &&
        "supportedValuesOf" in Intl &&
        typeof Intl.supportedValuesOf === "function"
          ? Intl.supportedValuesOf("timeZone")
          : [];
      if (zones.length > 0) {
        if (!zones.includes(value)) return "timezone";
        return;
      }
      // Fallback: DateTimeFormat accepts the zone or throws.
      Intl.DateTimeFormat(undefined, { timeZone: value });
    } catch {
      return "timezone";
    }
  },
  async active_url(value) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "active_url";
    let host: string;
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      host = url.hostname;
    } catch {
      return "active_url";
    }
    if (!host) return "active_url";
    const checker = activeUrlChecker ?? defaultActiveUrlCheck;
    if (!(await checker(host))) return "active_url";
  },
  distinct(value, params, field, data) {
    if (isEmpty(value)) return;
    // Compare against sibling wildcard attributes (e.g. items.*.id).
    const star = field.replace(/\.\d+(?=\.|$)/g, ".*");
    if (!star.includes("*")) return;
    const siblings = expandAttribute(star, data);
    const mode = (params[0] ?? "").toLowerCase();
    const normalize = (v: unknown): unknown => {
      if (mode === "ignore_case" && typeof v === "string") {
        return v.toLowerCase();
      }
      return v;
    };
    const me = normalize(value);
    let matches = 0;
    for (const sibling of siblings) {
      const other = normalize(dataGet(data, sibling));
      if (mode === "strict" ? other === me : String(other) === String(me)) {
        matches++;
      }
    }
    if (matches > 1) return "distinct";
  },
  list(value) {
    if (isEmpty(value)) return;
    if (!Array.isArray(value)) return "list";
    // Arrays are always lists in JS; reject sparse holes.
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return "list";
    }
  },
  required_array_keys(value, params) {
    if (isEmpty(value)) return;
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      return "required_array_keys";
    }
    const obj = value as Record<string, unknown>;
    for (const key of params) {
      if (!(key in obj)) return "required_array_keys";
    }
  },
  /** Stop on first failure for this attribute (handled in runner). */
  bail() {
    return undefined;
  },
  /** Only validate when the attribute is present (handled in runner). */
  sometimes() {
    return undefined;
  },
  /** Complexity rules via `Password.default()` (handled in runner). */
  password() {
    return undefined;
  },
  /** `regex:/pattern/` or `regex:pattern`. */
  regex(value, params) {
    if (isEmpty(value)) return;
    if (typeof value !== "string") return "regex";
    const raw = params.join(",");
    if (!raw) return "regex";
    let pattern = raw;
    let flags = "";
    if (raw.startsWith("/") && raw.lastIndexOf("/") > 0) {
      const end = raw.lastIndexOf("/");
      pattern = raw.slice(1, end);
      flags = raw.slice(end + 1);
    }
    try {
      if (!new RegExp(pattern, flags).test(value)) return "regex";
    } catch {
      return "regex";
    }
  },
  /** Uploaded file. */
  file(value) {
    if (isEmpty(value)) return;
    if (!isUploadedFile(value)) return "file";
    if (value.isValid && !value.isValid()) return "file";
  },
  /** Image MIME upload. */
  image(value) {
    if (isEmpty(value)) return;
    if (!isUploadedFile(value)) return "image";
    const mime = value.mimeType ?? "";
    if (!mime.startsWith("image/")) return "image";
  },
  /** `mimes:jpg,png`. */
  mimes(value, params) {
    if (isEmpty(value)) return;
    if (!isUploadedFile(value)) return "mimes";
    const ext = (
      value.clientOriginalExtension?.() ??
      ""
    ).toLowerCase();
    if (!params.map((p) => p.toLowerCase()).includes(ext)) return "mimes";
  },
  /**
   * `dimensions:min_width=100,min_height=100,max_width=…,ratio=3/2`.
   */
  async dimensions(value, params) {
    if (isEmpty(value)) return;
    if (!isUploadedFile(value)) return "dimensions";
    const file = value as {
      bytes?: () => Promise<Uint8Array>;
    };
    if (typeof file.bytes !== "function") return "dimensions";

    const constraints: Record<string, string> = {};
    for (const part of params) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      constraints[part.slice(0, eq)] = part.slice(eq + 1);
    }

    try {
      const { Image } = await import("@bunyad/image");
      const [width, height] = await Image.fromBytes(
        await file.bytes(),
      ).sourceDimensions();
      if (!width || !height) return "dimensions";

      const minW = constraints.min_width;
      const minH = constraints.min_height;
      const maxW = constraints.max_width;
      const maxH = constraints.max_height;
      const exactW = constraints.width;
      const exactH = constraints.height;
      const ratio = constraints.ratio;

      if (minW != null && width < Number(minW)) return "dimensions";
      if (minH != null && height < Number(minH)) return "dimensions";
      if (maxW != null && width > Number(maxW)) return "dimensions";
      if (maxH != null && height > Number(maxH)) return "dimensions";
      if (exactW != null && width !== Number(exactW)) return "dimensions";
      if (exactH != null && height !== Number(exactH)) return "dimensions";
      if (ratio != null) {
        const expected = parseRatio(ratio);
        if (expected == null) return "dimensions";
        const actual = width / height;
        if (Math.abs(actual - expected) > 0.01) return "dimensions";
      }
    } catch {
      return "dimensions";
    }
  },
  /**
   * `unique:table,column,except,idColumn`
   * Defaults: column = field name, idColumn = id.
   */
  async unique(value, params, field) {
    const table = params[0];
    const column = params[1] || field;
    const exceptValue = params[2];
    const idColumn = params[3] || "id";
    const except =
      exceptValue !== undefined && exceptValue !== ""
        ? { column: idColumn, value: exceptValue }
        : undefined;
    return checkPresence("unique", value, table, column, except);
  },
  /**
   * `exists:table,column`
   * Defaults: column = field name.
   */
  async exists(value, params, field) {
    const table = params[0];
    const column = params[1] || field;
    return checkPresence("exists", value, table, column);
  },
};

const messages: Record<string, (field: string, params: string[]) => string> =
  buildMessageFns(defaultValidationMessages);

let defaultMessagesBag: Record<string, MessageTemplate> = {
  ...defaultValidationMessages,
};

function buildMessageFns(
  bag: Record<string, MessageTemplate>,
): Record<string, (field: string, params: string[]) => string> {
  const out: Record<string, (field: string, params: string[]) => string> = {};
  for (const [key, value] of Object.entries(bag)) {
    if (typeof value === "function") {
      out[key] = value;
      continue;
    }
    out[key] = (field, params) =>
      formatMessageTemplate(value, field, key, params);
  }
  return out;
}

function formatMessageTemplate(
  template: string,
  field: string,
  rule: string,
  params: string[],
): string {
  const valueParam =
    rule === "accepted_if" || rule === "declined_if"
      ? params.slice(1).join(", ")
      : (params[1] ?? params[0] ?? "");
  return template
    .replaceAll(":attribute", field)
    .replaceAll(":Attribute", field)
    .replaceAll(":ATTRIBUTE", field.toUpperCase())
    .replaceAll(":other", params[0] ?? "")
    .replaceAll(":value", valueParam)
    .replaceAll(":date", params[0] ?? "")
    .replaceAll(":format", params[0] ?? "")
    .replaceAll(":digits", params[0] ?? "")
    .replaceAll(":min", params[0] ?? "")
    .replaceAll(":max", params[1] ?? params[0] ?? "")
    .replaceAll(":values", params.join(", "))
    .replace(/:(\d+)/g, (_, i) => params[Number(i)] ?? "");
}

/** Replace the default English message catalog (apps / locale packages). */
export function setDefaultMessages(
  bag: Record<string, MessageTemplate>,
): void {
  defaultMessagesBag = { ...bag };
  for (const key of Object.keys(messages)) delete messages[key];
  Object.assign(messages, buildMessageFns(defaultMessagesBag));
}

/** Merge overrides into the default message catalog. */
export function addDefaultMessages(bag: Record<string, MessageTemplate>): void {
  defaultMessagesBag = { ...defaultMessagesBag, ...bag };
  Object.assign(messages, buildMessageFns(bag));
}

/** Snapshot of the current default message map. */
export function getDefaultMessages(): Record<string, MessageTemplate> {
  return { ...defaultMessagesBag };
}

/** Restore the packaged English defaults. */
export function resetDefaultMessages(): void {
  setDefaultMessages({ ...defaultValidationMessages });
}

function confirmationAttribute(field: string): string {
  const i = field.lastIndexOf(".");
  if (i === -1) return `${field}_confirmation`;
  return `${field.slice(0, i + 1)}${field.slice(i + 1)}_confirmation`;
}

function dataHas(target: unknown, path: string): boolean {
  const parts = path.split(".");
  let current: unknown = target;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return false;
    if (!(part in (current as object))) return false;
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function dataSet(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const nextPart = parts[i + 1]!;
    const asRecord = current as Record<string, unknown>;
    let child = asRecord[part];
    if (child === null || typeof child !== "object") {
      child = /^\d+$/.test(nextPart) ? [] : {};
      asRecord[part] = child;
    }
    current = child as Record<string, unknown> | unknown[];
  }
  const last = parts[parts.length - 1]!;
  (current as Record<string, unknown>)[last] = value;
}

/**
 * Expand `items.*.email` into concrete attributes (`items.0.email`, …).
 */
function expandAttribute(
  pattern: string,
  data: Record<string, unknown>,
): string[] {
  if (!pattern.includes("*")) return [pattern];

  const segments = pattern.split(".");
  const results: string[] = [];

  function walk(index: number, prefix: string): void {
    if (index === segments.length) {
      results.push(prefix);
      return;
    }
    const seg = segments[index]!;
    if (seg === "*") {
      const parent =
        prefix === "" ? data : dataGet(data, prefix);
      if (!Array.isArray(parent)) return;
      for (let i = 0; i < parent.length; i++) {
        const next = prefix === "" ? String(i) : `${prefix}.${i}`;
        walk(index + 1, next);
      }
      return;
    }
    const next = prefix === "" ? seg : `${prefix}.${seg}`;
    walk(index + 1, next);
  }

  walk(0, "");
  return results;
}

type NamedParsed = { kind: "named"; name: string; params: string[] };
type ObjectParsed = { kind: "object"; rule: ValidationRule };
type ExcludeParsed = { kind: "exclude" };
type DatabaseParsed = { kind: "database"; rule: DatabaseRule };
type ParsedRule = NamedParsed | ObjectParsed | ExcludeParsed | DatabaseParsed;

function isValidationRule(value: unknown): value is ValidationRule {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as ValidationRule).passes === "function" &&
    typeof (value as ValidationRule).message === "function"
  );
}

function parseRulePart(part: string): { name: string; params: string[] } {
  const colon = part.indexOf(":");
  if (colon === -1) return { name: part, params: [] };
  const name = part.slice(0, colon);
  const paramStr = part.slice(colon + 1);
  // Keep regex / mimes patterns intact where commas matter differently
  if (name === "regex") {
    return { name, params: [paramStr] };
  }
  return {
    name,
    params: paramStr ? paramStr.split(",") : [],
  };
}

/**
 * `parseRules` re-splits the same static rule string (e.g.
 * `"required|string|min:2"`) on every `.validate()` call across every
 * request. Rule strings passed as a single string are almost always the
 * same literal on every call, so cache the parse by string content —
 * bounded so dynamically-built rule strings (e.g. `Rule.requiredIf(...)`
 * with per-request values) can't grow it without limit.
 */
const RULE_STRING_CACHE_LIMIT = 2000;
const ruleStringCache = new Map<
  string,
  Array<{ name: string; params: string[] }>
>();

function parseRules(
  rule: string | string[],
): Array<{ name: string; params: string[] }> {
  if (Array.isArray(rule)) {
    return rule.map(parseRulePart);
  }
  const cached = ruleStringCache.get(rule);
  if (cached) return cached;
  const parsed = rule.split("|").map(parseRulePart);
  if (ruleStringCache.size >= RULE_STRING_CACHE_LIMIT) {
    ruleStringCache.clear();
  }
  ruleStringCache.set(rule, parsed);
  return parsed;
}

function isConditionalRules(value: unknown): value is ConditionalRules {
  return (
    value != null &&
    typeof value === "object" &&
    (value as ConditionalRules).__conditional === true
  );
}

function isExcludeRules(value: unknown): value is ExcludeRules {
  return (
    value != null &&
    typeof value === "object" &&
    (value as ExcludeRules).__exclude === true
  );
}

function isDatabaseRule(value: unknown): value is DatabaseRule {
  return value instanceof DatabaseRule;
}

/** Whether a named exclude_* rule removes the attribute from validated data. */
function namedRuleExcludes(
  name: string,
  params: string[],
  data: Record<string, unknown>,
): boolean {
  if (name === "exclude") return true;
  if (name === "exclude_if") {
    const other = params[0];
    if (!other) return false;
    const expected = params.slice(1);
    return expected.map(String).includes(String(dataGet(data, other)));
  }
  if (name === "exclude_unless") {
    const other = params[0];
    if (!other) return false;
    const expected = params.slice(1);
    return !expected.map(String).includes(String(dataGet(data, other)));
  }
  if (name === "exclude_with") {
    return params.some((p) => dataHas(data, p));
  }
  if (name === "exclude_without") {
    return params.some((p) => !dataHas(data, p));
  }
  return false;
}

function parseFieldRules(rule: FieldRules): ParsedRule[] {
  if (typeof rule === "string") {
    return parseRules(rule).map(
      (r): NamedParsed => ({ kind: "named", name: r.name, params: r.params }),
    );
  }
  if (isValidationRule(rule)) {
    return [{ kind: "object", rule }];
  }
  if (isDatabaseRule(rule)) {
    return [{ kind: "database", rule }];
  }
  if (isExcludeRules(rule) || isConditionalRules(rule)) {
    // Resolved asynchronously in the runner.
    return [];
  }
  const out: ParsedRule[] = [];
  for (const item of rule) {
    if (typeof item === "string") {
      for (const r of parseRules(item)) {
        out.push({ kind: "named", name: r.name, params: r.params });
      }
    } else if (isDatabaseRule(item)) {
      out.push({ kind: "database", rule: item });
    } else if (isValidationRule(item)) {
      out.push({ kind: "object", rule: item });
    }
  }
  return out;
}

async function resolveFieldRules(rule: FieldRules): Promise<ParsedRule[]> {
  if (isExcludeRules(rule)) {
    const ok =
      typeof rule.condition === "function"
        ? await rule.condition()
        : rule.condition;
    return ok ? [{ kind: "exclude" }] : [];
  }
  if (isConditionalRules(rule)) {
    const ok =
      typeof rule.condition === "function"
        ? await rule.condition()
        : rule.condition;
    return resolveFieldRules(ok ? rule.rules : (rule.defaultRules ?? []));
  }
  if (Array.isArray(rule)) {
    const out: ParsedRule[] = [];
    for (const item of rule) {
      if (isExcludeRules(item) || isConditionalRules(item)) {
        out.push(...(await resolveFieldRules(item)));
      } else {
        out.push(...(await resolveFieldRules(item as FieldRules)));
      }
    }
    return out;
  }
  return parseFieldRules(rule);
}

/**
 * `Rule` helper — returns string / fluent rules consumed by the validator.
 */
export const Rule = {
  in(values: unknown[]): string {
    return `in:${values.map(String).join(",")}`;
  },
  notIn(values: unknown[]): string {
    return `not_in:${values.map(String).join(",")}`;
  },
  required(): string {
    return "required";
  },
  requiredIf(other: string, ...values: unknown[]): string {
    return `required_if:${other},${values.map(String).join(",")}`;
  },
  requiredUnless(other: string, ...values: unknown[]): string {
    return `required_unless:${other},${values.map(String).join(",")}`;
  },
  requiredWith(...fields: string[]): string {
    return `required_with:${fields.join(",")}`;
  },
  requiredWithout(...fields: string[]): string {
    return `required_without:${fields.join(",")}`;
  },
  prohibited(): string {
    return "prohibited";
  },
  prohibitedIf(other: string, ...values: unknown[]): string {
    return `prohibited_if:${other},${values.map(String).join(",")}`;
  },
  prohibitedUnless(other: string, ...values: unknown[]): string {
    return `prohibited_unless:${other},${values.map(String).join(",")}`;
  },
  prohibits(...fields: string[]): string {
    return `prohibits:${fields.join(",")}`;
  },
  presentIf(other: string, ...values: unknown[]): string {
    return `present_if:${other},${values.map(String).join(",")}`;
  },
  presentUnless(other: string, ...values: unknown[]): string {
    return `present_unless:${other},${values.map(String).join(",")}`;
  },
  presentWith(...fields: string[]): string {
    return `present_with:${fields.join(",")}`;
  },
  presentWithAll(...fields: string[]): string {
    return `present_with_all:${fields.join(",")}`;
  },
  missingIf(other: string, ...values: unknown[]): string {
    return `missing_if:${other},${values.map(String).join(",")}`;
  },
  missingUnless(other: string, ...values: unknown[]): string {
    return `missing_unless:${other},${values.map(String).join(",")}`;
  },
  missingWith(...fields: string[]): string {
    return `missing_with:${fields.join(",")}`;
  },
  missingWithAll(...fields: string[]): string {
    return `missing_with_all:${fields.join(",")}`;
  },
  digits(length: number): string {
    return `digits:${length}`;
  },
  digitsBetween(min: number, max: number): string {
    return `digits_between:${min},${max}`;
  },
  decimal(minPlaces: number, maxPlaces?: number): string {
    return maxPlaces == null
      ? `decimal:${minPlaces}`
      : `decimal:${minPlaces},${maxPlaces}`;
  },
  multipleOf(value: number): string {
    return `multiple_of:${value}`;
  },
  startsWith(...values: string[]): string {
    return `starts_with:${values.join(",")}`;
  },
  endsWith(...values: string[]): string {
    return `ends_with:${values.join(",")}`;
  },
  doesntStartWith(...values: string[]): string {
    return `doesnt_start_with:${values.join(",")}`;
  },
  doesntEndWith(...values: string[]): string {
    return `doesnt_end_with:${values.join(",")}`;
  },
  hexColor(): string {
    return "hex_color";
  },
  macAddress(): string {
    return "mac_address";
  },
  timezone(): string {
    return "timezone";
  },
  activeUrl(): string {
    return "active_url";
  },
  distinct(mode?: "strict" | "ignore_case"): string {
    return mode ? `distinct:${mode}` : "distinct";
  },
  list(): string {
    return "list";
  },
  requiredArrayKeys(...keys: string[]): string {
    return `required_array_keys:${keys.join(",")}`;
  },
  exclude(): string {
    return "exclude";
  },
  excludeIfField(other: string, ...values: unknown[]): string {
    return `exclude_if:${other},${values.map(String).join(",")}`;
  },
  excludeUnlessField(other: string, ...values: unknown[]): string {
    return `exclude_unless:${other},${values.map(String).join(",")}`;
  },
  excludeWith(...fields: string[]): string {
    return `exclude_with:${fields.join(",")}`;
  },
  excludeWithout(...fields: string[]): string {
    return `exclude_without:${fields.join(",")}`;
  },
  sometimes(): string {
    return "sometimes";
  },
  bail(): string {
    return "bail";
  },
  email(): string {
    return "email";
  },
  integer(): string {
    return "integer";
  },
  numeric(): string {
    return "numeric";
  },
  boolean(): string {
    return "boolean";
  },
  array(): string {
    return "array";
  },
  string(): string {
    return "string";
  },
  nullable(): string {
    return "nullable";
  },
  filled(): string {
    return "filled";
  },
  present(): string {
    return "present";
  },
  missing(): string {
    return "missing";
  },
  same(other: string): string {
    return `same:${other}`;
  },
  different(other: string): string {
    return `different:${other}`;
  },
  confirmed(): string {
    return "confirmed";
  },
  date(): string {
    return "date";
  },
  dateTime(): string {
    return "date";
  },
  accepted(): string {
    return "accepted";
  },
  declined(): string {
    return "declined";
  },
  acceptedIf(other: string, ...values: unknown[]): string {
    return `accepted_if:${other},${values.map(String).join(",")}`;
  },
  declinedIf(other: string, ...values: unknown[]): string {
    return `declined_if:${other},${values.map(String).join(",")}`;
  },
  after(date: string): string {
    return `after:${date}`;
  },
  afterOrEqual(date: string): string {
    return `after_or_equal:${date}`;
  },
  before(date: string): string {
    return `before:${date}`;
  },
  beforeOrEqual(date: string): string {
    return `before_or_equal:${date}`;
  },
  dateEquals(date: string): string {
    return `date_equals:${date}`;
  },
  dateFormat(format: string): string {
    return `date_format:${format}`;
  },
  gt(field: string | number): string {
    return `gt:${field}`;
  },
  gte(field: string | number): string {
    return `gte:${field}`;
  },
  lt(field: string | number): string {
    return `lt:${field}`;
  },
  lte(field: string | number): string {
    return `lte:${field}`;
  },
  file(): string {
    return "file";
  },
  image(): string {
    return "image";
  },
  imageFile(): string {
    return "image";
  },
  mimes(...exts: string[]): string {
    return `mimes:${exts.join(",")}`;
  },
  min(value: number): string {
    return `min:${value}`;
  },
  max(value: number): string {
    return `max:${value}`;
  },
  between(min: number, max: number): string {
    return `between:${min},${max}`;
  },
  size(value: number): string {
    return `size:${value}`;
  },
  regex(pattern: string): string {
    return `regex:${pattern}`;
  },
  notRegex(pattern: string): string {
    return `not_regex:${pattern}`;
  },
  uuid(): string {
    return "uuid";
  },
  ulid(): string {
    return "ulid";
  },
  alpha(): string {
    return "alpha";
  },
  alphaNum(): string {
    return "alpha_num";
  },
  alphaDash(): string {
    return "alpha_dash";
  },
  ip(): string {
    return "ip";
  },
  ipv4(): string {
    return "ipv4";
  },
  ipv6(): string {
    return "ipv6";
  },
  json(): string {
    return "json";
  },
  contains(values: unknown[]): string {
    return `contains:${values.map(String).join(",")}`;
  },
  doesntContain(values: unknown[]): string {
    return `doesnt_contain:${values.map(String).join(",")}`;
  },
  unique(table: string, column = "NULL"): DatabaseRule {
    return new DatabaseRule("unique", table, column);
  },
  exists(table: string, column = "NULL"): DatabaseRule {
    return new DatabaseRule("exists", table, column);
  },
  enum(enumType: Record<string, string | number>): string {
    const values = Object.values(enumType).filter(
      (v) => typeof v === "string" || typeof v === "number",
    );
    return `in:${values.map(String).join(",")}`;
  },
  when(
    condition: boolean | (() => boolean | Promise<boolean>),
    rules: FieldRules,
    defaultRules: FieldRules = [],
  ): ConditionalRules {
    return { __conditional: true, condition, rules, defaultRules };
  },
  unless(
    condition: boolean | (() => boolean | Promise<boolean>),
    rules: FieldRules,
    defaultRules: FieldRules = [],
  ): ConditionalRules {
    return {
      __conditional: true,
      condition: async () =>
        !(typeof condition === "function" ? await condition() : condition),
      rules,
      defaultRules,
    };
  },
  /** Exclude the attribute when the condition is true. */
  excludeIf(
    condition: boolean | (() => boolean | Promise<boolean>),
  ): ExcludeRules {
    return { __exclude: true, condition };
  },
  /** Exclude the attribute unless the condition is true. */
  excludeUnless(
    condition: boolean | (() => boolean | Promise<boolean>),
  ): ExcludeRules {
    return {
      __exclude: true,
      condition: async () =>
        !(typeof condition === "function" ? await condition() : condition),
    };
  },
  dimensions(constraints: {
    min_width?: number;
    min_height?: number;
    max_width?: number;
    max_height?: number;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    width?: number;
    height?: number;
    ratio?: string | number;
  }): string {
    const parts: string[] = [];
    const minW = constraints.min_width ?? constraints.minWidth;
    const minH = constraints.min_height ?? constraints.minHeight;
    const maxW = constraints.max_width ?? constraints.maxWidth;
    const maxH = constraints.max_height ?? constraints.maxHeight;
    if (minW != null) parts.push(`min_width=${minW}`);
    if (minH != null) parts.push(`min_height=${minH}`);
    if (maxW != null) parts.push(`max_width=${maxW}`);
    if (maxH != null) parts.push(`max_height=${maxH}`);
    if (constraints.width != null) parts.push(`width=${constraints.width}`);
    if (constraints.height != null) parts.push(`height=${constraints.height}`);
    if (constraints.ratio != null) parts.push(`ratio=${constraints.ratio}`);
    return `dimensions:${parts.join(",")}`;
  },
  /** Laravel `Rule::password()` — uses `Password::defaults()` when set. */
  password(): Password {
    return Password.default();
  },
  /**
   * Laravel `Rule::can($ability, ...$arguments)`.
   * Field value is appended as the last Gate argument.
   */
  can(ability: string, ...arguments_: unknown[]): Can {
    return new Can(ability, arguments_);
  },
  /**
   * `Gate.any` over abilities with the same arg/value pattern as `Rule.can`
   * (Authorizable `canAny` counterpart for validation).
   */
  canAny(abilities: string | string[], ...arguments_: unknown[]): CanAny {
    return new CanAny(abilities, arguments_);
  },
  /** Laravel `current_password` / `current_password:guard`. */
  currentPassword(guard?: string): string {
    return guard ? `current_password:${guard}` : "current_password";
  },
  ascii(): string {
    return "ascii";
  },
  lowercase(): string {
    return "lowercase";
  },
  uppercase(): string {
    return "uppercase";
  },
};
/**
 * `Validator` instance — `Validator::make(...)->fails()` / `validate()`.
 */
export class Validator {
  #errors: Record<string, string[]> = {};
  #failedRules: Record<string, string[]> = {};
  #validated: Record<string, unknown> = {};
  #failed = false;
  #attributeNames: Record<string, string> = {};
  #customMessages: Record<string, string> = {};
  #afterCallbacks: Array<(validator: Validator) => void | Promise<void>> = [];
  #stopOnFirstFailure = false;
  #authUser: { password?: string } | null | undefined;
  data: Record<string, unknown>;
  ruleMap: Rules;

  constructor(data: Record<string, unknown>, ruleMap: Rules) {
    this.data = data;
    this.ruleMap = ruleMap;
  }

  /** Authenticated user for `current_password` (Laravel request user). */
  setUser(user: { password?: string } | null | undefined): this {
    this.#authUser = user;
    return this;
  }

  /** `Validator::make`. */
  static make(data: Record<string, unknown>, rules: Rules): Validator {
    return new Validator(data, rules);
  }

  /** Replace the package default message catalog. */
  static setDefaultMessages(bag: Record<string, MessageTemplate>): void {
    setDefaultMessages(bag);
  }

  /** Merge overrides into the package default message catalog. */
  static addDefaultMessages(bag: Record<string, MessageTemplate>): void {
    addDefaultMessages(bag);
  }

  /** `Validator::extend` — register a custom rule. */
  static extend(name: string, callback: RuleFn): void {
    rules[name] = callback;
  }

  /** Register a custom message replacer for a named rule. */
  static replacer(rule: string, callback: ReplacerFn): void {
    customReplacers[rule] = callback;
  }

  /** Custom display names for attributes (`email` → `email address`). */
  setAttributeNames(names: Record<string, string>): this {
    this.#attributeNames = { ...this.#attributeNames, ...names };
    return this;
  }

  /** Alias of `setAttributeNames` (Laravel `attributes`). */
  attributes(names: Record<string, string>): this {
    return this.setAttributeNames(names);
  }

  addCustomAttributes(names: Record<string, string>): this {
    return this.setAttributeNames(names);
  }

  /** Custom messages keyed by `field.rule` or `rule`. */
  setCustomMessages(msgs: Record<string, string>): this {
    this.#customMessages = { ...this.#customMessages, ...msgs };
    return this;
  }

  /** Register an after-validation callback (Laravel `after`). */
  after(
    callback: ((validator: Validator) => void | Promise<void>) | Array<(validator: Validator) => void | Promise<void>>,
  ): this {
    const list = Array.isArray(callback) ? callback : [callback];
    this.#afterCallbacks.push(...list);
    return this;
  }

  stopOnFirstFailure(stop = true): this {
    this.#stopOnFirstFailure = stop;
    return this;
  }

  getData(): Record<string, unknown> {
    return this.data;
  }

  setData(data: Record<string, unknown>): this {
    this.data = data;
    return this;
  }

  getRules(): Rules {
    return this.ruleMap;
  }

  setRules(rulesMap: Rules): this {
    this.ruleMap = rulesMap;
    return this;
  }

  addRules(rulesMap: Rules): this {
    this.ruleMap = { ...this.ruleMap, ...rulesMap };
    return this;
  }

  /** Conditionally add rules (Laravel `sometimes`). */
  sometimes(
    attribute: string | string[],
    rulesToAdd: FieldRules,
    callback?: (input: Record<string, unknown>) => boolean,
  ): this {
    const keys = Array.isArray(attribute) ? attribute : [attribute];
    for (const key of keys) {
      const apply = callback ? callback(this.data) : dataHas(this.data, key);
      if (!apply) continue;
      const existing = this.ruleMap[key];
      if (!existing) this.ruleMap[key] = rulesToAdd;
      else if (typeof existing === "string" && typeof rulesToAdd === "string") {
        this.ruleMap[key] = `${existing}|${rulesToAdd}`;
      } else {
        const a = Array.isArray(existing) ? existing : [existing];
        const b = Array.isArray(rulesToAdd) ? rulesToAdd : [rulesToAdd];
        this.ruleMap[key] = [...a, ...b];
      }
    }
    return this;
  }

  addFailure(attribute: string, rule: string, message?: string): this {
    if (!this.#errors[attribute]) this.#errors[attribute] = [];
    if (!this.#failedRules[attribute]) this.#failedRules[attribute] = [];
    this.#errors[attribute]!.push(
      message ?? this.#messageFor(attribute, rule, []),
    );
    this.#failedRules[attribute]!.push(rule);
    this.#failed = true;
    return this;
  }

  async passes(): Promise<boolean> {
    await this.#run();
    return !this.#failed;
  }

  async fails(): Promise<boolean> {
    return !(await this.passes());
  }

  errors(): Record<string, string[]> {
    return this.#errors;
  }

  /** Message bag (Laravel `messages` / `getMessageBag`). */
  messages(): MessageBag {
    return new MessageBag(this.#errors);
  }

  getMessageBag(): MessageBag {
    return this.messages();
  }

  /** Failed rule names per attribute (Laravel `failed`). */
  failed(): Record<string, string[]> {
    return { ...this.#failedRules };
  }

  /** Validated data without throwing (empty when failed). */
  validated(): Record<string, unknown> {
    return this.#validated;
  }

  /** Subset of validated keys (Laravel `safe()->only`). */
  safe(keys?: string[]): Record<string, unknown> {
    if (!keys) return { ...this.#validated };
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (dataHas(this.#validated, key)) {
        dataSet(out, key, dataGet(this.#validated, key));
      }
    }
    return out;
  }

  /** `$validator->validate()` — throws on failure. */
  async validate(): Promise<Record<string, unknown>> {
    await this.#run();
    if (this.#failed) throw new ValidationException(this.#errors);
    return this.#validated;
  }

  #displayName(field: string): string {
    return this.#attributeNames[field] ?? field.replaceAll("_", " ");
  }

  #messageFor(
    field: string,
    fail: string,
    params: string[],
  ): string {
    const display = this.#displayName(field);
    const custom =
      this.#customMessages[`${field}.${fail}`] ??
      this.#customMessages[fail];
    let msg =
      custom != null
        ? formatMessageTemplate(custom, display, fail, params)
        : (messages[fail]?.(display, params) ??
          `The ${display} field is invalid.`);
    const replacer = customReplacers[fail];
    if (replacer) {
      msg = replacer(msg, field, fail, params);
    }
    return msg;
  }

  async #run(): Promise<void> {
    this.#errors = {};
    this.#failedRules = {};
    this.#validated = {};
    this.#failed = false;
    this.data = normalizeInput(this.data) as Record<string, unknown>;

    for (const [pattern, rule] of Object.entries(this.ruleMap)) {
      const attributes = expandAttribute(pattern, this.data);
      const parsedRules = await resolveFieldRules(rule);
      const nullable = parsedRules.some(
        (r) => r.kind === "named" && r.name === "nullable",
      );
      const context: RuleContext = {
        hasNumeric: parsedRules.some(
          (r) =>
            r.kind === "named" &&
            (r.name === "numeric" || r.name === "integer"),
        ),
        user: this.#authUser,
      };

      for (const field of attributes) {
        const value = dataGet(this.data, field);
        const fieldErrors: string[] = [];
        const fieldFailed: string[] = [];

        const hasSometimes = parsedRules.some(
          (r) => r.kind === "named" && r.name === "sometimes",
        );
        if (hasSometimes && !dataHas(this.data, field)) {
          continue;
        }

        const excluded = parsedRules.some((r) => {
          if (r.kind === "exclude") return true;
          if (r.kind === "named") {
            return namedRuleExcludes(r.name, r.params, this.data);
          }
          return false;
        });
        if (excluded) continue;

        for (const parsed of parsedRules) {
          if (parsed.kind === "exclude") continue;
          if (
            parsed.kind === "named" &&
            (parsed.name === "nullable" ||
              parsed.name === "bail" ||
              parsed.name === "sometimes" ||
              parsed.name === "exclude" ||
              parsed.name === "exclude_if" ||
              parsed.name === "exclude_unless" ||
              parsed.name === "exclude_with" ||
              parsed.name === "exclude_without")
          ) {
            continue;
          }
          if (
            nullable &&
            isEmpty(value) &&
            !(parsed.kind === "named" && parsed.name === "required")
          ) {
            continue;
          }

          if (parsed.kind === "named" && parsed.name === "password") {
            const pwd = Password.default();
            const ok = await pwd.passes(field, value, this.data, {
              user: this.#authUser,
            });
            if (!ok) {
              fieldErrors.push(
                formatMessageTemplate(pwd.message(), this.#displayName(field), "password", []),
              );
              fieldFailed.push("password");
              if (
                this.#stopOnFirstFailure ||
                parsedRules.some(
                  (r) => r.kind === "named" && r.name === "bail",
                )
              ) {
                break;
              }
            }
            continue;
          }

          if (parsed.kind === "object") {
            const ok = await parsed.rule.passes(field, value, this.data, { user: this.#authUser });
            if (!ok) {
              fieldErrors.push(parsed.rule.message());
              fieldFailed.push("custom");
              if (
                this.#stopOnFirstFailure ||
                parsedRules.some(
                  (r) => r.kind === "named" && r.name === "bail",
                )
              ) {
                break;
              }
            }
            continue;
          }

          if (parsed.kind === "database") {
            const dr = parsed.rule;
            const column =
              dr.column && dr.column !== "NULL" ? dr.column : field;
            const fail = await checkPresence(
              dr.kind,
              value,
              dr.table,
              column,
              dr.except(),
              dr.getWheres(),
            );
            if (fail) {
              fieldErrors.push(this.#messageFor(field, fail, []));
              fieldFailed.push(dr.kind);
              if (
                this.#stopOnFirstFailure ||
                parsedRules.some(
                  (r) => r.kind === "named" && r.name === "bail",
                )
              ) {
                break;
              }
            }
            continue;
          }

          const fn = rules[parsed.name];
          if (!fn) continue;
          const fail = await fn(
            value,
            parsed.params,
            field,
            this.data,
            context,
          );
          if (fail) {
            fieldErrors.push(this.#messageFor(field, fail, parsed.params));
            fieldFailed.push(parsed.name);
            if (
              this.#stopOnFirstFailure ||
              parsedRules.some((r) => r.kind === "named" && r.name === "bail")
            ) {
              break;
            }
          }
        }

        if (fieldErrors.length > 0) {
          this.#errors[field] = fieldErrors;
          this.#failedRules[field] = fieldFailed;
          this.#failed = true;
          if (this.#stopOnFirstFailure) break;
        } else if (dataHas(this.data, field)) {
          dataSet(this.#validated, field, coerceValidated(value, parsedRules));
        }
      }
      if (this.#failed && this.#stopOnFirstFailure) break;
    }

    for (const cb of this.#afterCallbacks) {
      await cb(this);
    }
  }
}

export type ValidateOptions = {
  attributes?: Record<string, string>;
  messages?: Record<string, string>;
  /** Authenticated user for `current_password` (e.g. FormRequest.user). */
  user?: { password?: string } | null;
};

/**
 * `validate()` helper — throws ValidationException on failure.
 */
export async function validate(
  data: Record<string, unknown>,
  ruleMap: Rules,
  options: ValidateOptions = {},
): Promise<Record<string, unknown>> {
  const v = Validator.make(data, ruleMap);
  if (options.attributes) v.setAttributeNames(options.attributes);
  if (options.messages) v.setCustomMessages(options.messages);
  if (options.user !== undefined) v.setUser(options.user);
  return v.validate();
}

/** `validator()` helper — returns a Validator instance. */
export function validator(
  data: Record<string, unknown>,
  rulesMap: Rules,
): Validator {
  return Validator.make(data, rulesMap);
}
