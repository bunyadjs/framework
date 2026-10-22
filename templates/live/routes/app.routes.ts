/** Who may open the rest of the app. Paths are relative to `routes/`. */
export default {
  rules: {
    auth: ["dashboard", "settings/**"],
    verified: "dashboard",
    "password.confirm": "settings/two-factor",
  },
};
