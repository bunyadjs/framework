import type { Mailer, MailMessage } from "@bunyad/contracts";

/**
 * Logs mail to the console (dev default).
 */
export class LogMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    const to = Array.isArray(message.to) ? message.to.join(", ") : message.to;
    console.log(`[mail] to=${to} subject=${message.subject}`);
  }
}
