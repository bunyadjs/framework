export default {
  name: process.env.APP_NAME ?? "Bunyad",
  env: process.env.APP_ENV ?? "local",
  debug: process.env.APP_DEBUG !== "false",
  port: Number(process.env.PORT ?? 3000),
  url: process.env.APP_URL ?? "http://localhost:3000",
};
