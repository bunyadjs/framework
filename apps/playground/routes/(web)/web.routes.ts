/** The web interface: sessions, CSRF and Inertia. Who must be signed in is listed here; sign-in pages are in `(guest)`. */
export default {
  use: ["web"],
  rules: { auth: ["dashboard", "notes", "notes/**", "horizon", "horizon/**"] },
};
