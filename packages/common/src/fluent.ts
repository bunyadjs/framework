import { filled } from "./helpers.ts";
import { Collection, collect } from "./collection.ts";

/**
 * Lightweight attribute bag (`Fluent`).
 */
export class Fluent {
  readonly #attributes: Record<string, unknown>;

  constructor(attributes: Record<string, unknown> = {}) {
    this.#attributes = { ...attributes };
  }

  static make(attributes: Record<string, unknown> = {}): Fluent {
    return new Fluent(attributes);
  }

  get<T = unknown>(key: string, fallback?: T): T | undefined {
    if (key in this.#attributes) return this.#attributes[key] as T;
    return fallback;
  }

  set(key: string, value: unknown): this {
    this.#attributes[key] = value;
    return this;
  }

  fill(attributes: Record<string, unknown>): this {
    Object.assign(this.#attributes, attributes);
    return this;
  }

  has(...keys: string[]): boolean {
    return keys.every((key) => key in this.#attributes);
  }

  hasAny(...keys: string[]): boolean {
    return keys.some((key) => key in this.#attributes);
  }

  missing(...keys: string[]): boolean {
    return keys.every((key) => !(key in this.#attributes));
  }

  exists(key: string): boolean {
    return this.has(key);
  }

  filled(...keys: string[]): boolean {
    return keys.every((key) => filled(this.#attributes[key]));
  }

  isNotFilled(...keys: string[]): boolean {
    return keys.every((key) => !filled(this.#attributes[key]));
  }

  anyFilled(...keys: string[]): boolean {
    return keys.some((key) => filled(this.#attributes[key]));
  }

  isEmpty(): boolean {
    return Object.keys(this.#attributes).length === 0;
  }

  isNotEmpty(): boolean {
    return !this.isEmpty();
  }

  all(): Record<string, unknown> {
    return { ...this.#attributes };
  }

  getAttributes(): Record<string, unknown> {
    return this.all();
  }

  toArray(): Record<string, unknown> {
    return this.all();
  }

  toJSON(): Record<string, unknown> {
    return this.all();
  }

  toJson(): string {
    return JSON.stringify(this.all());
  }

  toPrettyJson(): string {
    return JSON.stringify(this.all(), null, 2);
  }

  only(...keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (key in this.#attributes) out[key] = this.#attributes[key];
    }
    return out;
  }

  except(...keys: string[]): Record<string, unknown> {
    const skip = new Set(keys);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.#attributes)) {
      if (!skip.has(key)) out[key] = value;
    }
    return out;
  }

  value<T = unknown>(key: string, fallback?: T): T | undefined {
    return this.get(key, fallback);
  }

  data(key?: string, fallback?: unknown): unknown {
    if (key === undefined) return this.all();
    return this.get(key, fallback);
  }

  string(key: string, fallback = ""): string {
    const v = this.get(key);
    if (v === null || v === undefined) return fallback;
    return String(v);
  }

  str(key: string, fallback = ""): string {
    return this.string(key, fallback);
  }

  integer(key: string, fallback = 0): number {
    const v = this.get(key);
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  float(key: string, fallback = 0): number {
    const v = this.get(key);
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : fallback;
  }

  boolean(key: string, fallback = false): boolean {
    const v = this.get(key);
    if (v === null || v === undefined) return fallback;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    const s = String(v).toLowerCase();
    if (["1", "true", "on", "yes"].includes(s)) return true;
    if (["0", "false", "off", "no"].includes(s)) return false;
    return fallback;
  }

  array(key: string, fallback: unknown[] = []): unknown[] {
    const v = this.get(key);
    if (v === null || v === undefined) return fallback;
    if (Array.isArray(v)) return v;
    if (v instanceof Collection) return v.all();
    return fallback;
  }

  collect(key?: string): Collection<unknown> {
    if (key === undefined) return collect(Object.values(this.#attributes));
    return collect(this.array(key));
  }

  date(key: string, fallback: Date | null = null): Date | null {
    const v = this.get(key);
    if (v === null || v === undefined || v === "") return fallback;
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? fallback : d;
  }

  enum<E extends Record<string, string | number>>(
    key: string,
    enumType: E,
  ): E[keyof E] | null {
    const v = this.get(key);
    if (v === null || v === undefined) return null;
    const values = Object.values(enumType);
    return values.includes(v as string | number) ? (v as E[keyof E]) : null;
  }

  enums<E extends Record<string, string | number>>(
    key: string,
    enumType: E,
  ): Array<E[keyof E]> {
    const values = this.array(key);
    const allowed = new Set(Object.values(enumType));
    return values.filter((v) => allowed.has(v as string | number)) as Array<
      E[keyof E]
    >;
  }

  clamp(key: string, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.float(key)));
  }

  scope(key: string, callback: (value: unknown, fluent: this) => void): this {
    if (this.has(key)) callback(this.get(key), this);
    return this;
  }

  when(
    condition: boolean | ((fluent: this) => boolean),
    callback: (fluent: this) => unknown,
    defaultCallback?: (fluent: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    if (pass) callback(this);
    else if (defaultCallback) defaultCallback(this);
    return this;
  }

  unless(
    condition: boolean | ((fluent: this) => boolean),
    callback: (fluent: this) => unknown,
    defaultCallback?: (fluent: this) => unknown,
  ): this {
    const pass = typeof condition === "function" ? condition(this) : condition;
    return this.when(!pass, callback, defaultCallback);
  }

  whenHas(key: string, callback: (fluent: this) => unknown, defaultCallback?: (fluent: this) => unknown): this {
    return this.when(this.has(key), callback, defaultCallback);
  }

  whenMissing(key: string, callback: (fluent: this) => unknown, defaultCallback?: (fluent: this) => unknown): this {
    return this.when(this.missing(key), callback, defaultCallback);
  }

  whenFilled(key: string, callback: (fluent: this) => unknown, defaultCallback?: (fluent: this) => unknown): this {
    return this.when(filled(this.get(key)), callback, defaultCallback);
  }

  whenEnum(
    key: string,
    enumType: Record<string, string | number>,
    callback: (fluent: this) => unknown,
    defaultCallback?: (fluent: this) => unknown,
  ): this {
    return this.when(this.enum(key, enumType) != null, callback, defaultCallback);
  }

  /** Duration-like value from attributes (raw; no Carbon port). */
  interval(key: string, fallback: unknown = null): unknown {
    return this.get(key, fallback);
  }
}
