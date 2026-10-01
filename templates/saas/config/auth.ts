/**
 * Authentication defaults, named guards, and user providers.
 *
 * `web` / `token` are wired by AuthServiceProvider when the provider's model
 * (`app/Models/User.ts` here) and optional `PersonalAccessToken` exist. Extra
 * named guards with `session` or `token` drivers alias those instances via
 * `Auth.extend`.
 */
export default {
  defaults: {
    guard: "web",
    passwords: "users",
  },

  guards: {
    web: {
      driver: "session",
      provider: "users",
    },
    token: {
      driver: "token",
      provider: "users",
    },
  },

  providers: {
    users: {
      driver: "orm",
      model: "User",
    },
  },

  passwords: {
    users: {
      provider: "users",
      table: "password_reset_tokens",
      expire: 60,
      throttle: 60,
    },
  },

  /** Seconds until `password.confirm` expires (default 3 hours). */
  password_timeout: 10800,
};
