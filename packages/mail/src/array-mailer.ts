import type { Mailer, MailMessage } from "@bunyad/contracts";

/**
 * Collects messages in memory — ideal for tests.
 */
export class ArrayMailer implements Mailer {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
  }

  flush(): MailMessage[] {
    const out = [...this.messages];
    this.messages.length = 0;
    return out;
  }
}
