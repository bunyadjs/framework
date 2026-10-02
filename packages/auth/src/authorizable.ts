import type { Authenticatable } from "./guard.ts";
import { Gate } from "./gate.ts";

/** Mixin base — any constructable class (e.g. ORM `Model`). */
type Constructor = new (...args: any[]) => object;

/**
 * Mixin adding authorization helpers to a user model.
 *
 * Usage: `class User extends Authorizable(Model) implements Authenticatable { … }`
 * Methods: `can` / `cannot` / `cant` / `canAny` → `Gate.forUser(this)`.
 */
export function Authorizable<TBase extends Constructor>(Base: TBase) {
  return class extends Base {
    /**
     * Whether the user may perform the ability.
     * Pass a string or list (all must pass, like `Gate.check`).
     */
    async can(
      abilities: string | string[],
      ...arguments_: unknown[]
    ): Promise<boolean> {
      const gate = Gate.forUser(this as unknown as Authenticatable);
      if (Array.isArray(abilities)) {
        return gate.check(undefined, abilities, ...arguments_);
      }
      return gate.allows(undefined, abilities, ...arguments_);
    }

    /** Inverse of `can`. */
    async cannot(
      abilities: string | string[],
      ...arguments_: unknown[]
    ): Promise<boolean> {
      return !(await this.can(abilities, ...arguments_));
    }

    /** Alias of `cannot`. */
    async cant(
      abilities: string | string[],
      ...arguments_: unknown[]
    ): Promise<boolean> {
      return this.cannot(abilities, ...arguments_);
    }

    /** Whether at least one ability passes. */
    async canAny(
      abilities: string[],
      ...arguments_: unknown[]
    ): Promise<boolean> {
      return Gate.forUser(this as unknown as Authenticatable).any(
        undefined,
        abilities,
        ...arguments_,
      );
    }
  };
}

/** Instance shape added by {@link Authorizable}. */
export type AuthorizableInstance = {
  can(
    abilities: string | string[],
    ...arguments_: unknown[]
  ): Promise<boolean>;
  cannot(
    abilities: string | string[],
    ...arguments_: unknown[]
  ): Promise<boolean>;
  cant(
    abilities: string | string[],
    ...arguments_: unknown[]
  ): Promise<boolean>;
  canAny(abilities: string[], ...arguments_: unknown[]): Promise<boolean>;
};
