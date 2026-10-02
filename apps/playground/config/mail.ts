/**
 * mail config.
 * Set `MAIL_MAILER` / mailer credentials via env or override mailers below.
 */
export default {
  default: process.env.MAIL_MAILER ?? "array",
  from: {
    address:
      process.env.MAIL_FROM_ADDRESS ??
      process.env.MAIL_FROM ??
      "noreply@bunyad.test",
    name: process.env.MAIL_FROM_NAME ?? "Bunyad",
  },
  mailers: {
    array: { transport: "array" },
    log: { transport: "log" },
    smtp: {
      transport: "smtp",
      host: process.env.MAIL_HOST ?? "127.0.0.1",
      port: Number(process.env.MAIL_PORT ?? 1025),
      username: process.env.MAIL_USERNAME,
      password: process.env.MAIL_PASSWORD,
      tls: process.env.MAIL_TLS === "true",
    },
    resend: {
      transport: "resend",
      key: process.env.RESEND_API_KEY,
    },
    postmark: {
      transport: "postmark",
      token: process.env.POSTMARK_API_KEY ?? process.env.MAIL_PASSWORD,
    },
    mailgun: {
      transport: "mailgun",
      secret: process.env.MAILGUN_SECRET ?? process.env.MAIL_PASSWORD,
      domain: process.env.MAILGUN_DOMAIN,
      endpoint: process.env.MAILGUN_ENDPOINT,
    },
    ses: {
      transport: "ses",
      key: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    },
  },
};
