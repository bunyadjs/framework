import { ServiceProvider } from "@bunyad/core";
import type { Mailer } from "@bunyad/contracts";
import {
  ArrayMailer,
  LogMailer,
  SmtpMailer,
  ResendMailer,
  PostmarkMailer,
  MailgunMailer,
  SesMailer,
  FailoverMailer,
  RoundRobinMailer,
  Mail,
  setMailer,
  registerMailer,
  clearNamedMailers,
  hasNamedMailer,
  getNamedMailer,
} from "@bunyad/mail";
import { setScheduleMailSender } from "@bunyad/schedule";
import { discoverMailables } from "../discovery.ts";

export type MailerConfig = {
  transport?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  tls?: boolean;
  key?: string;
  token?: string;
  secret?: string;
  domain?: string;
  endpoint?: string;
  region?: string;
  /** Nested mailer names for failover / roundrobin. */
  mailers?: string[];
  retry_after?: number;
};

export type MailConfig = {
  default?: string;
  /** Legacy string from address, or `{ address, name }`. */
  from?: string | { address?: string; name?: string };
  mailers?: Record<string, MailerConfig>;
};

function resolveFrom(config: MailConfig): string {
  if (typeof config.from === "string") return config.from;
  return (
    config.from?.address ??
    process.env.MAIL_FROM_ADDRESS ??
    process.env.MAIL_FROM ??
    "noreply@bunyad.test"
  );
}

function createTransport(
  name: string,
  config: MailConfig,
  creating: Set<string> = new Set(),
): Mailer {
  if (creating.has(name)) {
    throw new Error(`Circular mailer dependency involving [${name}].`);
  }
  creating.add(name);

  const from = resolveFrom(config);
  const mailer = config.mailers?.[name] ?? {};
  const transport = mailer.transport ?? name;

  if (transport === "failover") {
    const names = mailer.mailers ?? [];
    if (names.length === 0) {
      throw new Error(`Failover mailer [${name}] has no mailers.`);
    }
    return new FailoverMailer(
      names.map((child) => resolveOrCreate(child, config, creating)),
    );
  }

  if (transport === "roundrobin" || transport === "round_robin") {
    const names = mailer.mailers ?? [];
    if (names.length === 0) {
      throw new Error(`Round-robin mailer [${name}] has no mailers.`);
    }
    return new RoundRobinMailer(
      names.map((child) => resolveOrCreate(child, config, creating)),
    );
  }

  if (transport === "log") return new LogMailer();
  if (transport === "smtp") {
    return new SmtpMailer({
      host: mailer.host ?? process.env.MAIL_HOST ?? "127.0.0.1",
      port: Number(mailer.port ?? process.env.MAIL_PORT ?? 1025),
      from,
      username: mailer.username ?? process.env.MAIL_USERNAME,
      password: mailer.password ?? process.env.MAIL_PASSWORD,
      tls: mailer.tls ?? process.env.MAIL_TLS === "true",
    });
  }
  if (transport === "resend") {
    return new ResendMailer({
      apiKey: mailer.key ?? process.env.RESEND_API_KEY ?? "",
      from,
    });
  }
  if (transport === "postmark") {
    return new PostmarkMailer({
      apiKey:
        mailer.token ??
        process.env.POSTMARK_API_KEY ??
        process.env.MAIL_PASSWORD ??
        "",
      from,
    });
  }
  if (transport === "mailgun") {
    return new MailgunMailer({
      apiKey:
        mailer.secret ??
        process.env.MAILGUN_SECRET ??
        process.env.MAIL_PASSWORD ??
        "",
      domain: mailer.domain ?? process.env.MAILGUN_DOMAIN ?? "",
      from,
      endpoint: mailer.endpoint ?? process.env.MAILGUN_ENDPOINT,
    });
  }
  if (transport === "ses") {
    return new SesMailer({
      accessKeyId: mailer.key ?? process.env.AWS_ACCESS_KEY_ID ?? "",
      secretAccessKey:
        mailer.secret ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
      region: mailer.region ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
      from,
    });
  }
  return new ArrayMailer();
}

function resolveOrCreate(
  name: string,
  config: MailConfig,
  creating: Set<string>,
): Mailer {
  if (hasNamedMailer(name)) return getNamedMailer(name);
  const created = createTransport(name, config, new Set(creating));
  registerMailer(name, created);
  return created;
}

export class MailServiceProvider extends ServiceProvider {
  register(): void {
    const config = this.app.config.get<MailConfig>("mail") ?? {};
    clearNamedMailers();

    for (const name of Object.keys(config.mailers ?? {})) {
      if (!hasNamedMailer(name)) {
        registerMailer(name, createTransport(name, config));
      }
    }

    const defaultName =
      config.default ?? process.env.MAIL_MAILER ?? "array";
    const mailer = hasNamedMailer(defaultName)
      ? getNamedMailer(defaultName)
      : createTransport(defaultName, config);
    if (!hasNamedMailer(defaultName)) {
      registerMailer(defaultName, mailer);
    }

    setMailer(mailer);
    this.app.instance("mailer", mailer);
    setScheduleMailSender(async (addresses, subject, body) => {
      await Mail.raw(body, addresses, subject);
    });
  }

  async boot(): Promise<void> {
    await discoverMailables(this.app);
  }
}
