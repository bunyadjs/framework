import type { Request } from "@bunyad/http";
import { abort } from "@bunyad/http";
import { AccessResponse } from "./access-response.ts";
import type { Authenticatable } from "./guard.ts";
import { Auth } from "./guard.ts";

export type GateUser = Authenticatable | null;

export type GateCallback = (
  user: GateUser,
  ...args: unknown[]
) => boolean | AccessResponse | Promise<boolean | AccessResponse>;

export type GateBeforeCallback = (
  user: GateUser,
  ability: string,
  ...args: unknown[]
) =>
  | boolean
  | AccessResponse
  | null
  | undefined
  | Promise<boolean | AccessResponse | null | undefined>;

export type GateAfterCallback = (
  user: GateUser,
  ability: string,
  result: boolean,
  ...args: unknown[]
) => boolean | null | undefined | Promise<boolean | null | undefined>;

export type PolicyClass = new () => object;

/** `Gate.define('edit', [PostPolicy, 'update'])` class/method tuple. */
export type PolicyMethodTuple = readonly [PolicyClass, string];

type ModelClass = abstract new (...args: never[]) => object;

const DEFAULT_RESOURCE_ABILITIES: Record<string, string> = {
  viewAny: "viewAny",
  view: "view",
  create: "create",
  update: "update",
  delete: "delete",
};

type PolicyInstance = Record<
  string,
  (
    user: GateUser,
    ...rest: unknown[]
  ) => boolean | AccessResponse | Promise<boolean | AccessResponse>
> & {
  before?: GateBeforeCallback;
};

function isPolicyMethodTuple(
  value: GateCallback | PolicyMethodTuple,
): value is PolicyMethodTuple {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "function" &&
    typeof value[1] === "string"
  );
}

/**
 * Authorization Gate (`Gate.allows`, `authorize`, …).
 */
type PolicyNameGuesser = (
  modelClass: ModelClass,
) => string[] | string | null | undefined;

export class GateManager {
  #abilities = new Map<string, GateCallback>();
  #policies = new Map<ModelClass, PolicyClass>();
  #beforeCallbacks: GateBeforeCallback[] = [];
  #afterCallbacks: GateAfterCallback[] = [];
  #fixedUser: GateUser | undefined;
  #guessPolicyNames: PolicyNameGuesser | null = null;

  /**
   * Register an ability callback, or a `[PolicyClass, 'method']` tuple.
   */
  define(
    ability: string,
    callback: GateCallback | PolicyMethodTuple,
  ): this {
    if (isPolicyMethodTuple(callback)) {
      const [Policy, method] = callback;
      this.#abilities.set(ability, async (user, ...args) => {
        const instance = new Policy() as PolicyInstance;
        const before = instance.before;
        if (typeof before === "function") {
          const early = await before.call(instance, user, ability, ...args);
          if (early !== null && early !== undefined) return early;
        }
        const fn = instance[method];
        if (typeof fn !== "function") return false;
        return await fn.call(instance, user, ...args);
      });
      return this;
    }
    this.#abilities.set(ability, callback);
    return this;
  }

  /**
   * Custom policy class-name guesser before convention discovery
   * (`Gate.guessPolicyNamesUsing`).
   */
  guessPolicyNamesUsing(callback: PolicyNameGuesser | null): this {
    this.#guessPolicyNames = callback;
    return this;
  }

  /** Registered guesser, if any. */
  getPolicyNameGuesser(): PolicyNameGuesser | null {
    return this.#guessPolicyNames;
  }

  /** Register a policy for a model class (`Gate.policy(Post, PostPolicy)`). */
  policy(model: ModelClass, policy: PolicyClass): this {
    this.#policies.set(model, policy);
    return this;
  }

  /** Defined policies (Laravel `Gate::policies`). */
  policies(): Map<ModelClass, PolicyClass> {
    return new Map(this.#policies);
  }

  /**
   * Define resource abilities (`posts.view`, `posts.update`, …)
   * (Laravel `Gate::resource`).
   */
  resource(
    name: string,
    policy: PolicyClass,
    abilities: Record<string, string> | null = null,
  ): this {
    const map = abilities ?? DEFAULT_RESOURCE_ABILITIES;
    for (const [ability, method] of Object.entries(map)) {
      this.define(`${name}.${ability}`, async (user, ...args) => {
        const instance = new policy() as PolicyInstance;
        const before = instance.before;
        if (typeof before === "function") {
          const early = await before.call(
            instance,
            user,
            `${name}.${ability}`,
            ...args,
          );
          if (early !== null && early !== undefined) return early;
        }
        const fn = instance[method];
        if (typeof fn !== "function") return false;
        return await fn.call(instance, user, ...args);
      });
    }
    return this;
  }

  /** Create an allow response (Laravel `Gate::allow`). */
  allow(
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return AccessResponse.allow(message, code);
  }

  /** Create a deny response (Laravel `Gate::deny`). */
  deny(
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return AccessResponse.deny(message, code);
  }

  /** Deny with an HTTP status (Laravel `Gate::denyWithStatus`). */
  denyWithStatus(
    status: number,
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return AccessResponse.denyWithStatus(status, message, code);
  }

  /** Deny as not found (Laravel `Gate::denyAsNotFound`). */
  denyAsNotFound(
    message: string | null = null,
    code: string | number | null = null,
  ): AccessResponse {
    return AccessResponse.denyAsNotFound(message, code);
  }

  /**
   * On-demand allow — throws when condition is false (Laravel `Gate::allowIf`).
   */
  async allowIf(
    condition:
      | boolean
      | AccessResponse
      | (() => boolean | AccessResponse | Promise<boolean | AccessResponse>),
    message: string | null = null,
    code: string | number | null = null,
  ): Promise<AccessResponse> {
    return this.authorizeOnDemand(condition, message, code, true);
  }

  /**
   * On-demand deny — throws when condition is true (Laravel `Gate::denyIf`).
   */
  async denyIf(
    condition:
      | boolean
      | AccessResponse
      | (() => boolean | AccessResponse | Promise<boolean | AccessResponse>),
    message: string | null = null,
    code: string | number | null = null,
  ): Promise<AccessResponse> {
    return this.authorizeOnDemand(condition, message, code, false);
  }

  /** Laravel `Gate::authorizeOnDemand`. */
  async authorizeOnDemand(
    condition:
      | boolean
      | AccessResponse
      | (() => boolean | AccessResponse | Promise<boolean | AccessResponse>),
    message: string | null = null,
    code: string | number | null = null,
    allowWhenTrue = true,
  ): Promise<AccessResponse> {
    const resolved =
      typeof condition === "function" ? await condition() : condition;
    if (resolved instanceof AccessResponse) {
      if (allowWhenTrue ? resolved.denied() : resolved.allowed()) {
        resolved.authorize();
      }
      return resolved;
    }
    const passes = allowWhenTrue ? !!resolved : !resolved;
    if (!passes) {
      abort(403, message ?? "This action is unauthorized.");
    }
    return AccessResponse.allow(message, code);
  }

  /** Laravel `Gate::before`. */
  before(callback: GateBeforeCallback): this {
    this.#beforeCallbacks.push(callback);
    return this;
  }

  /** Laravel `Gate::after`. */
  after(callback: GateAfterCallback): this {
    this.#afterCallbacks.push(callback);
    return this;
  }

  /** Whether an ability is defined (Laravel `Gate::has`). */
  has(ability: string): boolean {
    return this.#abilities.has(ability);
  }

  /** Defined ability names (Laravel `Gate::abilities`). */
  abilities(): string[] {
    return [...this.#abilities.keys()];
  }

  /** Resolve a policy instance for a model (Laravel `Gate::getPolicyFor`). */
  getPolicyFor(model: object | ModelClass): object | null {
    const ctor =
      typeof model === "function"
        ? (model as ModelClass)
        : ((model as object).constructor as ModelClass);
    const Policy = this.#policies.get(ctor);
    return Policy ? new Policy() : null;
  }

  /**
   * Authorize as a specific user without a request (Laravel `Gate::forUser`).
   */
  forUser(user: GateUser): GateManager {
    const scoped = new GateManager();
    scoped.#abilities = new Map(this.#abilities);
    scoped.#policies = new Map(this.#policies);
    scoped.#beforeCallbacks = [...this.#beforeCallbacks];
    scoped.#afterCallbacks = [...this.#afterCallbacks];
    scoped.#guessPolicyNames = this.#guessPolicyNames;
    scoped.#fixedUser = user;
    return scoped;
  }

  async #resolveUser(request?: Request): Promise<GateUser> {
    if (this.#fixedUser !== undefined) return this.#fixedUser;
    if (!request) return null;
    return (await Auth().user(request)) as GateUser;
  }

  async inspect(
    request: Request | undefined,
    ability: string,
    ...args: unknown[]
  ): Promise<AccessResponse> {
    const user = await this.#resolveUser(request);
    const raw = await this.raw(request, ability, ...args);
    let response: AccessResponse;
    if (raw instanceof AccessResponse) {
      response = raw;
    } else if (raw === null || raw === undefined) {
      response = AccessResponse.deny();
    } else {
      response = raw ? AccessResponse.allow() : AccessResponse.deny();
    }
    const allowed = await this.#runAfter(
      user,
      ability,
      response.allowed(),
      args,
    );
    if (allowed === response.allowed()) return response;
    return allowed ? AccessResponse.allow() : AccessResponse.deny();
  }

  /**
   * Raw ability result before boolean coercion (Laravel `Gate::raw`).
   */
  async raw(
    request: Request | undefined,
    ability: string,
    ...args: unknown[]
  ): Promise<boolean | AccessResponse | null> {
    const user = await this.#resolveUser(request);

    for (const before of this.#beforeCallbacks) {
      const result = await before(user, ability, ...args);
      if (result !== null && result !== undefined) return result;
    }

    const model = args[0];
    if (model && typeof model === "object") {
      const Policy = this.#policies.get(
        (model as object).constructor as ModelClass,
      );
      if (Policy) {
        const instance = new Policy() as PolicyInstance;
        const policyBefore = instance.before;
        if (typeof policyBefore === "function") {
          const early = await policyBefore.call(
            instance,
            user,
            ability,
            ...args,
          );
          if (early !== null && early !== undefined) return early;
        }
        const method = instance[ability];
        if (typeof method === "function") {
          return await method.call(instance, user, ...args);
        }
      }
    }

    const callback = this.#abilities.get(ability);
    if (callback) return await callback(user, ...args);
    return null;
  }

  async allows(
    request: Request | undefined,
    ability: string,
    ...args: unknown[]
  ): Promise<boolean> {
    const user = await this.#resolveUser(request);
    const raw = await this.raw(request, ability, ...args);
    let allowed = false;
    if (raw instanceof AccessResponse) allowed = raw.allowed();
    else if (raw !== null && raw !== undefined) allowed = !!raw;
    return this.#runAfter(user, ability, allowed, args);
  }

  /**
   * Sync ability check for view directives (`@can` / `@cannot`).
   * Uses the fixed user (from `forUser`) or `request.user` when already set.
   * Async Gate callbacks and unresolved users return `false`.
   */
  allowsSync(
    request: Request | undefined,
    ability: string,
    ...args: unknown[]
  ): boolean {
    const user =
      this.#fixedUser !== undefined
        ? this.#fixedUser
        : ((request?.user as GateUser | undefined) ?? null);

    for (const before of this.#beforeCallbacks) {
      const result = before(user, ability, ...args);
      if (result instanceof Promise) return false;
      if (result !== null && result !== undefined) {
        return result instanceof AccessResponse ? result.allowed() : !!result;
      }
    }

    const model = args[0];
    if (model && typeof model === "object") {
      const Policy = this.#policies.get(
        (model as object).constructor as ModelClass,
      );
      if (Policy) {
        const instance = new Policy() as PolicyInstance;
        const policyBefore = instance.before;
        if (typeof policyBefore === "function") {
          const early = policyBefore.call(instance, user, ability, ...args);
          if (early instanceof Promise) return false;
          if (early !== null && early !== undefined) {
            return early instanceof AccessResponse
              ? early.allowed()
              : !!early;
          }
        }
        const method = instance[ability];
        if (typeof method === "function") {
          const result = method.call(instance, user, ...args);
          if (result instanceof Promise) return false;
          return result instanceof AccessResponse
            ? result.allowed()
            : !!result;
        }
      }
    }

    const callback = this.#abilities.get(ability);
    if (!callback) return false;
    const result = callback(user, ...args);
    if (result instanceof Promise) return false;
    let allowed =
      result instanceof AccessResponse ? result.allowed() : !!result;
    for (const after of this.#afterCallbacks) {
      const next = after(user, ability, allowed, ...args);
      if (next instanceof Promise) continue;
      if (next !== null && next !== undefined) allowed = !!next;
    }
    return allowed;
  }

  async #runAfter(
    user: GateUser,
    ability: string,
    result: boolean,
    args: unknown[],
  ): Promise<boolean> {
    let current = result;
    for (const after of this.#afterCallbacks) {
      const next = await after(user, ability, current, ...args);
      if (next !== null && next !== undefined) current = !!next;
    }
    return current;
  }

  async denies(
    request: Request | undefined,
    ability: string,
    ...args: unknown[]
  ): Promise<boolean> {
    return !(await this.allows(request, ability, ...args));
  }

  /** Laravel `Gate::check` — all abilities must pass. */
  async check(
    request: Request | undefined,
    abilities: string | string[],
    ...args: unknown[]
  ): Promise<boolean> {
    const list = Array.isArray(abilities) ? abilities : [abilities];
    for (const ability of list) {
      if (!(await this.allows(request, ability, ...args))) return false;
    }
    return true;
  }

  /** Laravel `Gate::any` — at least one ability passes. */
  async any(
    request: Request | undefined,
    abilities: string[],
    ...args: unknown[]
  ): Promise<boolean> {
    for (const ability of abilities) {
      if (await this.allows(request, ability, ...args)) return true;
    }
    return false;
  }

  /** Laravel `Gate::none` — no ability passes. */
  async none(
    request: Request | undefined,
    abilities: string[],
    ...args: unknown[]
  ): Promise<boolean> {
    return !(await this.any(request, abilities, ...args));
  }

  async authorize(
    request: Request | undefined,
    ability: string,
    ...args: unknown[]
  ): Promise<AccessResponse> {
    const response = await this.inspect(request, ability, ...args);
    response.authorize();
    return response;
  }

  /** Clear definitions (tests / re-bootstrap). */
  flush(): void {
    this.#abilities.clear();
    this.#policies.clear();
    this.#beforeCallbacks = [];
    this.#afterCallbacks = [];
    this.#fixedUser = undefined;
    this.#guessPolicyNames = null;
  }
}

export const Gate = new GateManager();

/** Laravel `$this->authorize(...)`. */
export function authorize(
  request: Request,
  ability: string,
  ...args: unknown[]
): Promise<AccessResponse> {
  return Gate.authorize(request, ability, ...args);
}
