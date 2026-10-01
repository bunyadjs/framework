import type { Request } from "@bunyad/http";
import type { Authenticatable, Credentials } from "./guard.ts";

/** Dispatched after a successful login. */
export class Login {
  constructor(
    readonly user: Authenticatable,
    readonly remember: boolean,
    readonly request?: Request,
    readonly guard?: string,
  ) {}
}

/** Dispatched when credentials fail validation. */
export class Failed {
  constructor(
    readonly credentials: Credentials,
    readonly user: Authenticatable | null,
    readonly request?: Request,
    readonly guard?: string,
  ) {}
}

/** Dispatched after logout. */
export class Logout {
  constructor(
    readonly user: Authenticatable | null,
    readonly request?: Request,
    readonly guard?: string,
  ) {}
}

/** Dispatched when a user is authenticated for the request (session restored). */
export class Authenticated {
  constructor(
    readonly user: Authenticatable,
    readonly request?: Request,
    readonly guard?: string,
  ) {}
}

/** Dispatched after a successful password confirmation. */
export class PasswordConfirmed {
  constructor(
    readonly user: Authenticatable,
    readonly request?: Request,
  ) {}
}

/** Dispatched by the app after a new user signs up. */
export class Registered {
  constructor(readonly user: Authenticatable) {}
}

/** Dispatched after a user verifies their email address. */
export class Verified {
  constructor(readonly user: Authenticatable) {}
}

/** Dispatched after a password is reset through the broker. */
export class PasswordReset {
  constructor(readonly user: Authenticatable) {}
}

export type AuthEvent =
  | Login
  | Failed
  | Logout
  | Authenticated
  | PasswordConfirmed
  | Registered
  | Verified
  | PasswordReset;

export type AuthEventDispatcher = {
  dispatch(event: AuthEvent): unknown;
};

let dispatcher: AuthEventDispatcher | null = null;

/** Live the application event bus (framework boots this). */
export function setAuthEventDispatcher(
  next: AuthEventDispatcher | null,
): void {
  dispatcher = next;
}

export async function dispatchAuthEvent(event: AuthEvent): Promise<void> {
  if (!dispatcher) return;
  await dispatcher.dispatch(event);
}
