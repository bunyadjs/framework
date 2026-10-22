/**
 * Who may open the sign-in pages. Everything here is for guests, except what is listed under `auth`:
 * those are for signed-in users. Paths are relative to this folder.
 */
export default {
  access: "guest",
  rules: {
    auth: ["confirm-password", "email/verify", "email/verify/*/*", "logout"],
  },
};
