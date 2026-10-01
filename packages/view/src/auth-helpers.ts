/**
 * Sync helpers for `@auth` / `@guest` / `@can` / `@cannot`.
 * The framework wires these to the current request and Gate; tests may override.
 */

export type ViewAuthHelpers = {
  /** Whether the current user is authenticated (optional guard name). */
  check(guard?: string): boolean;
  /** Whether the current user is a guest (optional guard name). */
  guest(guard?: string): boolean;
  /** Whether the ability is allowed. */
  can(ability: string, ...args: unknown[]): boolean;
  /** Whether the ability is denied. */
  cannot(ability: string, ...args: unknown[]): boolean;
};

const defaults: ViewAuthHelpers = {
  check() {
    return false;
  },
  guest() {
    return true;
  },
  can() {
    return false;
  },
  cannot() {
    return true;
  },
};

let helpers: ViewAuthHelpers = { ...defaults };

/** Replace sync auth/gate helpers used by compiled view directives. */
export function setViewAuthHelpers(next: Partial<ViewAuthHelpers> | null): void {
  if (next == null) {
    helpers = { ...defaults };
    return;
  }
  helpers = {
    check: next.check ?? helpers.check,
    guest: next.guest ?? helpers.guest,
    can: next.can ?? helpers.can,
    cannot: next.cannot ?? helpers.cannot,
  };
}

export function getViewAuthHelpers(): ViewAuthHelpers {
  return helpers;
}

/** Used by compiled `@auth` — prefers `data.user` / `data.__auth`, then registered helpers. */
export function viewAuthCheck(
  data: Record<string, unknown>,
  guard?: string,
): boolean {
  if (typeof data.__auth === "boolean") return data.__auth;
  if (data.user != null && data.user !== false) return true;
  return helpers.check(guard);
}

/** Used by compiled `@guest`. */
export function viewGuestCheck(
  data: Record<string, unknown>,
  guard?: string,
): boolean {
  if (typeof data.__guest === "boolean") return data.__guest;
  if (typeof data.__auth === "boolean") return !data.__auth;
  if (data.user != null && data.user !== false) return false;
  return helpers.guest(guard);
}

/** Used by compiled `@can`. */
export function viewCanCheck(
  data: Record<string, unknown>,
  ability: string,
  ...args: unknown[]
): boolean {
  const custom = data.__can;
  if (typeof custom === "function") {
    return !!(custom as (a: string, ...r: unknown[]) => boolean)(
      ability,
      ...args,
    );
  }
  return helpers.can(ability, ...args);
}

/** Used by compiled `@cannot`. */
export function viewCannotCheck(
  data: Record<string, unknown>,
  ability: string,
  ...args: unknown[]
): boolean {
  const custom = data.__cannot;
  if (typeof custom === "function") {
    return !!(custom as (a: string, ...r: unknown[]) => boolean)(
      ability,
      ...args,
    );
  }
  return helpers.cannot(ability, ...args);
}
