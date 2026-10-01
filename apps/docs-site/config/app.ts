export default {
  name: "Bunyad Docs",
  env: process.env.APP_ENV ?? "local",
  debug: process.env.APP_DEBUG === "true",
  port: Number(process.env.PORT ?? 4321),
  url: process.env.APP_URL ?? "http://localhost:4321",
};
