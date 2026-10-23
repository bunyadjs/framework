/** Who may open the rest of the app. Paths are relative to `routes/`. */
export default {
  rules: {
    auth: ["dashboard", "settings/**", "billing", "billing/**", "admin"],
    verified: "dashboard",
  },
};
