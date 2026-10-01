import type { Mailer, MailMessage } from "@bunyad/contracts";

/**
 * Distributes sends across mailers (load balancing).
 * Starts at a random index, then rotates for each subsequent send.
 */
export class RoundRobinMailer implements Mailer {
  #index: number;

  constructor(private readonly mailers: Mailer[]) {
    if (mailers.length === 0) {
      throw new Error("RoundRobinMailer requires at least one mailer.");
    }
    this.#index = Math.floor(Math.random() * mailers.length);
  }

  async send(message: MailMessage): Promise<void> {
    const start = this.#index;
    let lastError: unknown;
    for (let i = 0; i < this.mailers.length; i++) {
      const mailer = this.mailers[(start + i) % this.mailers.length]!;
      try {
        await mailer.send(message);
        this.#index = (start + i + 1) % this.mailers.length;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    this.#index = (start + 1) % this.mailers.length;
    throw lastError instanceof Error
      ? lastError
      : new Error("All round-robin mailers failed.");
  }
}
