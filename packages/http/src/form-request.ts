import { abort } from "./response.ts";
import { Request } from "./request.ts";
import type { Rules } from "@bunyad/validation";
import { validate } from "@bunyad/validation";

export type FormRequestCtor<T extends FormRequest<any> = FormRequest> = (new (
  raw: globalThis.Request,
  params?: Record<string, string>,
) => T) & {
  from(request: Request): Promise<T>;
};

function keyList(keys: string | string[]): string[] {
  return Array.isArray(keys) ? keys : [keys];
}

/** Filtered view of `validated()` (`only` / `except` / `all`). */
export class ValidatedInput {
  constructor(private readonly data: Record<string, unknown>) {}

  only(keys: string | string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of keyList(keys)) {
      if (Object.prototype.hasOwnProperty.call(this.data, key)) {
        out[key] = this.data[key];
      }
    }
    return out;
  }

  except(keys: string | string[]): Record<string, unknown> {
    const skip = new Set(keyList(keys));
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.data)) {
      if (!skip.has(key)) out[key] = value;
    }
    return out;
  }

  all(): Record<string, unknown> {
    return { ...this.data };
  }
}

/**
 * Form Request — authorize + rules on a dedicated class.
 *
 * ```ts
 * class StoreUserRequest extends FormRequest<{ email: string }> {
 *   authorize() { return true; }
 *   rules() { return { email: "required|email" }; }
 * }
 * const form = await StoreUserRequest.from(request);
 * form.validated();
 * ```
 */
export abstract class FormRequest<
  TValidated extends Record<string, unknown> = Record<string, unknown>,
> extends Request {
  #validated?: TValidated;
  #failOnUnknownFields = false;

  /** Hook before validation runs. */
  prepareForValidation(): void | Promise<void> {}

  /** Hook after validation succeeds. */
  passedValidation(): void | Promise<void> {}

  /** Whether authorization passes. */
  async passesAuthorization(): Promise<boolean> {
    return this.authorize();
  }

  /** Input used for validation. Keys match the request as sent. */
  validationData(): Record<string, unknown> {
    return this.all();
  }

  /** Rules for validation. */
  validationRules(): Rules {
    return this.rules();
  }

  /** Reject unknown fields during validation. */
  failOnUnknownFields(value = true): this {
    this.#failOnUnknownFields = value;
    return this;
  }

  shouldFailOnUnknownFields(): boolean {
    return this.#failOnUnknownFields;
  }

  /** Authorization gate — return false to abort 403. */
  authorize(): boolean | Promise<boolean> {
    return true;
  }

  abstract rules(): Rules;

  /** Custom attribute display names for error messages. */
  attributes(): Record<string, string> {
    return {};
  }

  /** Optional custom messages (`field.rule` or `rule`). */
  messages(): Record<string, string> {
    return {};
  }

  /** Authorize + validate an incoming request. Already-validated instances are reused. */
  static async from<T extends FormRequest<any>>(
    this: FormRequestCtor<T>,
    request: Request,
  ): Promise<T> {
    if (request instanceof this) {
      const existing = request as T;
      if (existing.#validated !== undefined) {
        return existing;
      }
    }
    const form = new this(
      request.raw,
      request.route() as Record<string, string>,
    );
    await request.loadJson();
    request.transferTo(form);

    if (!(await form.passesAuthorization())) {
      form.failedAuthorization();
    }

    await form.prepareForValidation();

    try {
      form.#validated = (await validate(form.validationData(), form.validationRules(), {
        user: (form.user as { password?: string } | undefined) ?? null,
        attributes: form.attributes(),
        messages: form.messages(),
      })) as Record<string, unknown>;
      if (form.shouldFailOnUnknownFields()) {
        form.validateNoUnknownFields();
      }
      await form.passedValidation();
    } catch (error) {
      form.failedValidation(error);
    }
    return form;
  }

  /** Ensure every input key is covered by rules. */
  validateNoUnknownFields(): void {
    const rules = this.validationRules();
    const known = new Set(Object.keys(rules));
    for (const key of Object.keys(this.validationData())) {
      if (!this.isKnownField(key, known)) {
        throw new Error(`Unknown field [${key}]`);
      }
    }
  }

  /** Whether a field is known to the rules bag. */
  isKnownField(key: string, known = new Set(Object.keys(this.validationRules()))): boolean {
    if (known.has(key)) return true;
    const top = key.split(".")[0]!;
    return known.has(top) || known.has(`${top}.*`);
  }

  /** Validated input bag, or a single key (optional default). */
  validated(): TValidated;
  validated<K extends keyof TValidated>(
    key: K,
    defaultValue?: TValidated[K],
  ): TValidated[K];
  validated(key: string, defaultValue?: unknown): unknown;
  validated(key?: string, defaultValue?: unknown): unknown {
    const data = this.#validated!;
    if (key === undefined) {
      return data;
    }
    return Object.prototype.hasOwnProperty.call(data, key)
      ? (data as Record<string, unknown>)[key]
      : defaultValue;
  }

  /** Validated bag with `only` / `except`. Pass keys for `only`. */
  safe(): ValidatedInput;
  safe(keys: string[]): Record<string, unknown>;
  safe(keys?: string[]): ValidatedInput | Record<string, unknown> {
    const bag = new ValidatedInput(this.validated() as Record<string, unknown>);
    return keys === undefined ? bag : bag.only(keys);
  }

  /** Route param id (string) from model binding or param bag. */
  routeId(key: string, idColumn = "id"): string | number | undefined {
    try {
      const model = this.model<Record<string, unknown>>(key);
      const id = model?.[idColumn];
      if (id !== undefined && id !== null) return id as string | number;
    } catch {
      // no bound model
    }
    const param = this.route(key);
    if (typeof param === "string" && param) return param;
    return undefined;
  }

  /** Override to customize the 403 response. */
  failedAuthorization(): never {
    abort(403, "This action is unauthorized.");
  }

  /** Override to customize validation failure. */
  failedValidation(error: unknown): never {
    throw error;
  }

  /**
   * Build a `unique:table,column,except,idColumn` rule string.
   * Omits except when id is null/undefined.
   */
  uniqueExcept(
    table: string,
    column: string,
    except?: string | number | null,
    idColumn = "id",
  ): string {
    if (except != null && except !== "") {
      return `unique:${table},${column},${except},${idColumn}`;
    }
    return `unique:${table},${column}`;
  }

  /** `unique` rule ignoring a route-model binding (update forms). */
  uniqueExceptRouteModel(
    table: string,
    column: string,
    routeKey: string,
    idColumn = "id",
  ): string {
    return this.uniqueExcept(table, column, this.routeId(routeKey, idColumn), idColumn);
  }
}

/** True when `value` is a FormRequest subclass constructor. */
export function isFormRequestCtor(
  value: unknown,
): value is FormRequestCtor {
  return (
    typeof value === "function" &&
    value !== FormRequest &&
    Boolean((value as { prototype?: unknown }).prototype) &&
    (value as { prototype: object }).prototype instanceof FormRequest
  );
}
