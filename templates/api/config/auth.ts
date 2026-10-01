/**
 * Token guard only. This app does not register a session store.
 */
export default {
  defaults: {
    guard: "token",
  },

  guards: {
    token: {
      driver: "token",
      provider: "users",
    },
  },

  // Users are the `@bunyad/orm` model `app/Models/{model}.ts`.
  providers: {
    users: {
      driver: "orm",
      model: "User",
    },
  },
};
