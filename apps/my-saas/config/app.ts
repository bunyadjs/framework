export default {
  name: process.env.APP_NAME ?? "Bunyad SaaS",
  env: process.env.APP_ENV ?? "local",
  debug: process.env.APP_DEBUG !== "false",
  port: Number(process.env.PORT ?? 3000),
  url: process.env.APP_URL ?? "http://localhost:3000",
  stripe: {
    key: process.env.STRIPE_KEY ?? process.env.STRIPE_PUBLISHABLE_KEY,
    secret: process.env.STRIPE_SECRET ?? process.env.STRIPE_SECRET_KEY,
    pricePro: process.env.STRIPE_PRICE_PRO ?? "price_pro",
  },
};
