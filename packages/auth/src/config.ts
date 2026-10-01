import { BunyadError } from "@bunyad/common";
import { setPasswordConfirmTimeout } from "./middleware.ts";
import {
  Auth,
  getAuthGuard,
  getTokenGuard,
  setDefaultGuardName,
} from "./guard.ts";

export type AuthGuardConfig = {
  driver: string;
  provider?: string;
};

export type AuthProviderConfig = {
  /** `orm`: users are `@bunyad/orm` models. The only driver. */
  driver: "orm";
  /** Model class under `app/Models` (default `User`). */
  model?: string;
};

export type AuthPasswordBrokerConfig = {
  provider?: string;
  table?: string;
  expire?: number;
  throttle?: number;
};

/**
 * Laravel-shaped `config/auth.ts` payload.
 */
export type AuthConfig = {
  defaults?: {
    guard?: string;
    passwords?: string;
  };
  guards?: Record<string, AuthGuardConfig>;
  providers?: Record<string, AuthProviderConfig>;
  passwords?: Record<string, AuthPasswordBrokerConfig>;
  /** Seconds for `password.confirm` (default 10800). */
  password_timeout?: number;
};

/**
 * The user model name (a file under `app/Models`) for the default guard's
 * provider: `guards[defaults.guard].provider` → `providers[name].model`.
 * `User` when the config does not say.
 */
export function userProviderModel(config: AuthConfig | null | undefined): string {
  const guard = config?.guards?.[config.defaults?.guard ?? "web"];
  const name = guard?.provider ?? "users";
  const provider = config?.providers?.[name];
  if (!provider) return "User";
  if (provider.driver !== "orm") {
    throw new BunyadError(
      `Auth provider [${name}] uses driver [${String(provider.driver)}]. Bunyad's user provider driver is "orm".`,
      "BUNYAD_AUTH_001",
    );
  }
  return provider.model ?? "User";
}

/**
 * Apply loaded auth config: password confirm timeout + named guard aliases.
 * Call after `discoverAuth` so `web` / `token` instances exist.
 */
export function applyAuthConfig(config: AuthConfig | null | undefined): void {
  if (!config) {
    setDefaultGuardName("web");
    return;
  }

  setDefaultGuardName(config.defaults?.guard ?? "web");

  if (typeof config.password_timeout === "number") {
    setPasswordConfirmTimeout(config.password_timeout);
  }

  for (const [name, guard] of Object.entries(config.guards ?? {})) {
    if (name === "web" || name === "token") continue;
    if (extendedAlready(name)) continue;

    if (guard.driver === "session") {
      Auth.extend(name, () => {
        const session = getAuthGuard();
        if (!session) {
          throw new Error(`Auth guard [${name}] requires the web session guard.`);
        }
        return session;
      });
    } else if (guard.driver === "token") {
      Auth.extend(name, () => {
        const token = getTokenGuard();
        if (!token) {
          throw new Error(`Auth guard [${name}] requires the token guard.`);
        }
        return token;
      });
    }
  }
}

function extendedAlready(name: string): boolean {
  try {
    Auth.guard(name);
    return true;
  } catch {
    return false;
  }
}
