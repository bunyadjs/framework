export default {
  name: "Bunyad",
  env: "local",
  debug: true,
  port: Number(process.env.PORT ?? 3000),
  url: process.env.APP_URL ?? "http://localhost:3000",
};
