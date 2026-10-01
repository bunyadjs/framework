import type { Mailer, MailMessage } from "@bunyad/contracts";

export type MailgunMailerOptions = {
  apiKey: string;
  domain: string;
  from: string;
  /** Override API base (tests). Default: https://api.mailgun.net */
  endpoint?: string;
  fetch?: typeof fetch;
};

/**
 * Send mail via the Mailgun Messages API.
 */
export class MailgunMailer implements Mailer {
  readonly #apiKey: string;
  readonly #domain: string;
  readonly #from: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: MailgunMailerOptions) {
    this.#apiKey = options.apiKey;
    this.#domain = options.domain;
    this.#from = options.from;
    this.#endpoint = options.endpoint ?? "https://api.mailgun.net";
    this.#fetch = options.fetch ?? fetch;
  }

  async send(message: MailMessage): Promise<void> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    const body = new URLSearchParams();
    body.set("from", message.from ?? this.#from);
    for (const addr of to) body.append("to", addr);
    for (const addr of Array.isArray(message.cc)
      ? message.cc
      : message.cc
        ? [message.cc]
        : []) {
      body.append("cc", addr);
    }
    for (const addr of Array.isArray(message.bcc)
      ? message.bcc
      : message.bcc
        ? [message.bcc]
        : []) {
      body.append("bcc", addr);
    }
    if (message.replyTo) {
      const reply = Array.isArray(message.replyTo)
        ? message.replyTo.join(",")
        : message.replyTo;
      body.set("h:Reply-To", reply);
    }
    body.set("subject", message.subject);
    if (message.text) body.set("text", message.text);
    if (message.html) body.set("html", message.html);

    const url = `${this.#endpoint}/v3/${this.#domain}/messages`;
    const res = await this.#fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`api:${this.#apiKey}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Mailgun API ${res.status}: ${text}`);
    }
  }
}
