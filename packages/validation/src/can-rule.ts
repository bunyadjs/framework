import type { ValidationRule } from "./validator.ts";

export type AbilityCheckMode = "can" | "canAny";

/**
 * Injected by AuthServiceProvider — keeps `@bunyad/validation` free of `@bunyad/auth`.
 * `args` already includes the field value as the last item.
 */
export type AbilityChecker = (
  mode: AbilityCheckMode,
  abilities: string | string[],
  args: unknown[],
  user: unknown,
) => boolean | Promise<boolean>;

let abilityChecker: AbilityChecker | null = null;

/** Framework registers Gate.forUser checks here. */
export function setAbilityChecker(checker: AbilityChecker | null): void {
  abilityChecker = checker;
}

export function getAbilityChecker(): AbilityChecker | null {
  return abilityChecker;
}

export type CanRuleContext = {
  user?: unknown;
};

/**
 * Gate args = `[...ruleArguments, fieldValue]` (value always last).
 */
export class Can implements ValidationRule {
  readonly #ability: string;
  readonly #arguments: unknown[];

  constructor(ability: string, arguments_: unknown[] = []) {
    this.#ability = ability;
    this.#arguments = arguments_;
  }

  async passes(
    _attribute: string,
    value: unknown,
    _data: Record<string, unknown>,
    context?: CanRuleContext,
  ): Promise<boolean> {
    const checker = abilityChecker;
    if (!checker) return false;
    const args = [...this.#arguments, value];
    return checker("can", this.#ability, args, context?.user ?? null);
  }

  message(): string {
    return "The :attribute field contains an unauthorized value.";
  }
}

/**
 * Bunyad extension — `Gate.any` over abilities with the same arg/value pattern as `Can`.
 * (Authorizable has `canAny`.)
 */
export class CanAny implements ValidationRule {
  readonly #abilities: string[];
  readonly #arguments: unknown[];

  constructor(abilities: string | string[], arguments_: unknown[] = []) {
    this.#abilities = Array.isArray(abilities) ? abilities : [abilities];
    this.#arguments = arguments_;
  }

  async passes(
    _attribute: string,
    value: unknown,
    _data: Record<string, unknown>,
    context?: CanRuleContext,
  ): Promise<boolean> {
    const checker = abilityChecker;
    if (!checker) return false;
    const args = [...this.#arguments, value];
    return checker("canAny", this.#abilities, args, context?.user ?? null);
  }

  message(): string {
    return "The :attribute field contains an unauthorized value.";
  }
}
