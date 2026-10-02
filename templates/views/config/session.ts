/**
 * Session configuration.
 * Driver: file | database | redis | memory | array
 */
export default {
  driver: process.env.SESSION_DRIVER ?? "file",
  lifetime: Number(process.env.SESSION_LIFETIME ?? 120),
  files: undefined as string | undefined,
  connection: process.env.SESSION_CONNECTION,
  table: process.env.SESSION_TABLE ?? "sessions",
  store: process.env.SESSION_STORE ?? "default",
  prefix: process.env.SESSION_COOKIE_PREFIX ?? "bunyad_session:",
};
