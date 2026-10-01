import { Auth, getPasswordConfirmTimeout } from "@bunyad/auth";
import { abort } from "@bunyad/http";
import type User from "@/Models/User.ts";

/**
 * The signed-in user for a Live action. Updates post to `/live/update`, which
 * skips the page route's middleware, so each action checks for itself.
 */
export async function currentUser(): Promise<User> {
  const user = await Auth.user(request());
  if (!user) abort(401);
  return user as User;
}

/** Same check as the `password.confirm` middleware, for Live actions. */
export function ensurePasswordConfirmed(): void {
  const confirmedAt = request().session!.get<number | undefined>("auth.password_confirmed_at");
  if (!confirmedAt || Date.now() / 1000 - confirmedAt >= getPasswordConfirmTimeout()) {
    abort(423, "Password confirmation required.");
  }
}

/** Where the user was headed before logging in, or `fallback`. */
export function intendedUrl(fallback: string): string {
  return request().session!.pull!<string>("url.intended", fallback);
}
