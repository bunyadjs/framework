import type { Mailer, MailMessage } from "@bunyad/contracts";

export type PostmarkMailerOptions = {
  apiKey: string;
  from: string;
  /** Override API endpoint (tests). */
  endpoint?: string;
  fetch?: typeof fetch;
};

/**
 * Send mail via the Postmark HTTP API.
 */
export class PostmarkMailer implements Mailer {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: PostmarkMailerOptions) {
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#endpoint =
      options.endpoint ?? "https://api.postmarkapp.com/email";
    this.#fetch = options.fetch ?? fetch;
  }

  async send(message: MailMessage): Promise<void> {
    const to = Array.isArray(message.to) ? message.to.join(",") : message.to;
    const cc = message.cc
      ? Array.isArray(message.cc)
        ? message.cc.join(",")
        : message.cc
      : undefined;
    const bcc = message.bcc
      ? Array.isArray(message.bcc)
        ? message.bcc.join(",")
        : message.bcc
      : undefined;
    const replyTo = message.replyTo
      ? Array.isArray(message.replyTo)
        ? message.replyTo.join(",")
        : message.replyTo
      : undefined;
    const res = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.#apiKey,
      },
      body: JSON.stringify({
        From: message.from ?? this.#from,
        To: to,
        Cc: cc,
        Bcc: bcc,
        ReplyTo: replyTo,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Postmark API ${res.status}: ${body}`);
    }
  }
}
