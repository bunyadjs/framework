import { ServiceProvider } from "@bunyad/core";
import {
  DatabasePasswordTokenRepository,
  Gate,
  Hash,
  PasswordBroker,
  Registered,
  applyAuthConfig,
  isMustVerifyEmail,
  sendEmailVerificationNotification,
  setEmailVerificationSender,
  setPasswordBroker,
  setTwoFactorIssuer,
  registerLoginLimiter,
  setAuthEventDispatcher,
  redirectGuestsTo,
  redirectUsersTo,
  type Authenticatable,
  type AuthConfig,
} from "@bunyad/auth";
import type { Connection } from "@bunyad/database";
import { getEventDispatcher } from "@bunyad/events";
import { notify, type Notifiable } from "@bunyad/notifications";
import type { Model } from "@bunyad/orm";
import {
  setAbilityChecker,
  setCurrentPasswordVerifier,
} from "@bunyad/validation";
import { setViewAuthHelpers } from "@bunyad/view";
import { Route, getUrlContext, route, url } from "@bunyad/router";
import { ResetPassword, VerifyEmail } from "../auth-notifications.ts";
import { discoverAuth, discoverPolicies } from "../discovery.ts";

type UserModel = typeof Model;

type SendsPasswordReset = Authenticatable & {
  sendPasswordResetNotification?(token: string): void | Promise<void>;
};

/**
 * Convention auth + policy discovery (`User` / `{Model}Policy`).
 * Registers `current_password` + `Rule.can` / `Rule.canAny` via Gate.
 * With sessions and a `User` model it also wires the password broker
 * (`config/auth.ts` `passwords`) and verification / reset mail.
 */
export class AuthServiceProvider extends ServiceProvider {
  register(): void {
    Gate.flush();
    registerLoginLimiter();
    try {
      setAuthEventDispatcher(getEventDispatcher());
    } catch {
      // EventServiceProvider may register later; boot re-wires.
    }
    setCurrentPasswordVerifier(async (plain, _guard, user) => {
      const hashed = user?.password;
      if (typeof hashed !== "string" || hashed.length === 0) return false;
      return Hash.check(plain, hashed);
    });
    setAbilityChecker(async (mode, abilities, args, user) => {
      const gate = Gate.forUser((user as Authenticatable | null) ?? null);
      if (mode === "canAny") {
        const list = Array.isArray(abilities) ? abilities : [abilities];
        return gate.any(undefined, list, ...args);
      }
      return gate.allows(undefined, String(abilities), ...args);
    });
    setViewAuthHelpers({
      check() {
        return !!getUrlContext().request?.user;
      },
      guest() {
        return !getUrlContext().request?.user;
      },
      can(ability, ...args) {
        const request = getUrlContext().request;
        const user = (request?.user as Authenticatable | null | undefined) ?? null;
        return Gate.forUser(user).allowsSync(request, ability, ...args);
      },
      cannot(ability, ...args) {
        const request = getUrlContext().request;
        const user = (request?.user as Authenticatable | null | undefined) ?? null;
        return !Gate.forUser(user).allowsSync(request, ability, ...args);
      },
    });
  }

  async boot(): Promise<void> {
    try {
      setAuthEventDispatcher(getEventDispatcher());
    } catch {
      // Optional when events are not booted (unit tests).
    }
    const [User] = await Promise.all([
      discoverAuth(this.app),
      discoverPolicies(this.app),
    ]);
    const config = this.app.config.get("auth") as AuthConfig | undefined;
    applyAuthConfig(config);
    setTwoFactorIssuer(String(this.app.config.get("app.name", "Bunyad")));

    setEmailVerificationSender((user, link) =>
      notify(user as unknown as Notifiable, new VerifyEmail(link)),
    );
    getEventDispatcher().listen(Registered, async (event: Registered) => {
      if (isMustVerifyEmail(event.user) && !event.user.hasVerifiedEmail()) {
        await sendEmailVerificationNotification(event.user);
      }
    });

    if (User && this.app.bound("session.store") && this.app.bound("db")) {
      this.#registerPasswordBroker(User, config);
    }

    const guests = this.app.getRedirectGuestsTo();
    if (guests !== undefined) {
      redirectGuestsTo(guests as Parameters<typeof redirectGuestsTo>[0]);
    }
    const users = this.app.getRedirectUsersTo();
    if (users !== undefined) {
      redirectUsersTo(users as Parameters<typeof redirectUsersTo>[0]);
    }
  }

  /** Default broker: `password_reset_tokens` rows + `ResetPassword` mail. */
  #registerPasswordBroker(User: UserModel, config: AuthConfig | undefined): void {
    const options = config?.passwords?.[config.defaults?.passwords ?? "users"] ?? {};
    const expire = options.expire ?? 60;

    setPasswordBroker(
      new PasswordBroker({
        retrieveByCredentials: (email) =>
          User.where("email", email).first() as Promise<Authenticatable | null>,
        tokens: new DatabasePasswordTokenRepository({
          connection: this.app.make<Connection>("db"),
          table: options.table,
          expire,
          throttle: options.throttle,
        }),
        createUrl: (email, token) =>
          Route.has("password.reset")
            ? route("password.reset", { token, email }, true)
            : url(`/reset-password/${token}?email=${encodeURIComponent(email)}`),
        sendResetNotification: async (user: SendsPasswordReset, token, link) => {
          if (user.sendPasswordResetNotification) {
            await user.sendPasswordResetNotification(token);
            return;
          }
          await notify(user as unknown as Notifiable, new ResetPassword(token, link, expire));
        },
      }),
    );
  }
}
