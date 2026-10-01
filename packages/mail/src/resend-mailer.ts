import type { Mailer, MailMessage } from "@bunyad/contracts";

export type ResendMailerOptions = {
  apiKey: string;
  from: string;
  /** Override API endpoint (tests). */
  endpoint?: string;
  fetch?: typeof fetch;
};

/**
 * Send mail via the Resend HTTP API.
 */
export class ResendMailer implements Mailer {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;

  constructor(options: ResendMailerOptions) {
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#endpoint = options.endpoint ?? "https://api.resend.com/emails";
    this.#fetch = options.fetch ?? fetch;
  }

  async send(message: MailMessage): Promise<void> {
    const to = Array.isArray(message.to) ? message.to : [message.to];
    const res = await this.#fetch(this.#endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: message.from ?? this.#from,
        to,
        cc: message.cc
          ? Array.isArray(message.cc)
            ? message.cc
            : [message.cc]
          : undefined,
        bcc: message.bcc
          ? Array.isArray(message.bcc)
            ? message.bcc
            : [message.bcc]
          : undefined,
        reply_to: message.replyTo
          ? Array.isArray(message.replyTo)
            ? message.replyTo[0]
            : message.replyTo
          : undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend API ${res.status}: ${body}`);
    }
  }
}
