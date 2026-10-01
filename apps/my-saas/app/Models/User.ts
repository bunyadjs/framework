import type { Authenticatable, TwoFactorAuthenticatableMethods } from "@bunyad/auth";
import { Authorizable, TwoFactorAuthenticatable } from "@bunyad/auth";
import { Billable } from "@bunyad/billing";
import { Model } from "@bunyad/orm";
import UserFactory from "@database/factories/UserFactory.ts";

// To require a verified email before the dashboard opens, add the
// `@MustVerifyEmail()` decorator from `@bunyad/auth` to this class.
@TwoFactorAuthenticatable()
export default class User extends Authorizable(Billable(Model)) implements Authenticatable {
  declare name: string;
  declare email: string;
  declare password?: string;
  declare email_verified_at?: Date | null;
  declare remember_token?: string | null;
  declare two_factor_secret?: string | null;
  declare two_factor_recovery_codes?: string | null;
  declare two_factor_confirmed_at?: Date | null;
  /** Denormalized display hint; use `subscribed()` for access control. */
  declare plan: string;
  declare stripe_id: string | null;
  declare pm_type: string | null;
  declare pm_last_four: string | null;
  declare trial_ends_at: Date | string | null;

  static table = "users";
  static fillable = ["name", "email", "password"];
  static hidden = ["password", "remember_token", "two_factor_secret", "two_factor_recovery_codes"];
  static casts = {
    email_verified_at: "datetime",
    two_factor_confirmed_at: "datetime",
    password: "hashed",
  } as const;

  static factory() {
    return new UserFactory();
  }

  /** Two-letter initials for the avatar in the sidebar. */
  initials(): string {
    return this.name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("");
  }
}

export default interface User extends TwoFactorAuthenticatableMethods {}
