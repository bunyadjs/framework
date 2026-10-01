import type { Mailer, MailMessage } from "@bunyad/contracts";

/**
 * Tries each mailer in order until one succeeds.
 */
export class FailoverMailer implements Mailer {
  constructor(private readonly mailers: Mailer[]) {
    if (mailers.length === 0) {
      throw new Error("FailoverMailer requires at least one mailer.");
    }
  }

  async send(message: MailMessage): Promise<void> {
    let lastError: unknown;
    for (const mailer of this.mailers) {
      try {
        await mailer.send(message);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All failover mailers failed.");
  }
}
