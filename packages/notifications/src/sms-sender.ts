import type { SmsMessage } from "./messages/sms-message.ts";

export type SmsSender = {
  send(to: string, message: SmsMessage): Promise<void>;
};

export type SentSmsMessage = {
  to: string;
  content: string;
  from?: string;
};

/** In-memory SMS sender for tests. */
export class ArraySmsSender implements SmsSender {
  readonly messages: SentSmsMessage[] = [];

  async send(to: string, message: SmsMessage): Promise<void> {
    this.messages.push({
      to,
      content: message.getContent(),
      from: message.getFrom(),
    });
  }
}

export type HttpSmsSenderOptions = {
  /** Full URL for the SMS HTTP API. */
  url: string;
  /** Optional Bearer / basic auth header value. */
  authorization?: string;
  /** Map to body fields expected by the provider. */
  buildBody?: (to: string, message: SmsMessage) => Record<string, unknown>;
};

/**
 * Generic HTTP SMS driver (works for Vonage-style JSON endpoints).
 */
export class HttpSmsSender implements SmsSender {
  constructor(private options: HttpSmsSenderOptions) {}

  async send(to: string, message: SmsMessage): Promise<void> {
    const body =
      this.options.buildBody?.(to, message) ??
      ({
        to,
        from: message.getFrom(),
        text: message.getContent(),
      } satisfies Record<string, unknown>);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.options.authorization) {
      headers.Authorization = this.options.authorization;
    }

    const res = await fetch(this.options.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`SMS send failed (${res.status}).`);
    }
  }
}
