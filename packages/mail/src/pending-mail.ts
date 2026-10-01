import type { Mailer } from "@bunyad/contracts";
import { normalizeAddresses, type MailAddress } from "./addresses.ts";
import {
  getNamedMailer,
  mail,
  type Mailable,
} from "./mailable.ts";

/**
 * Fluent recipient builder — `Mail.to(...).cc(...).send($mailable)`.
 */
export class PendingMail {
  #to: string[] = [];
  #cc: string[] = [];
  #bcc: string[] = [];
  #mailerName?: string;
  #locale?: string;

  constructor(mailerName?: string) {
    this.#mailerName = mailerName;
  }

  to(users: MailAddress | MailAddress[]): this {
    this.#to = normalizeAddresses(users);
    return this;
  }

  cc(users: MailAddress | MailAddress[]): this {
    this.#cc = normalizeAddresses(users);
    return this;
  }

  bcc(users: MailAddress | MailAddress[]): this {
    this.#bcc = normalizeAddresses(users);
    return this;
  }

  locale(locale: string): this {
    this.#locale = locale;
    return this;
  }

  mailer(name: string): this {
    this.#mailerName = name;
    return this;
  }

  #apply(mailable: Mailable): void {
    if (this.#to.length) mailable.to(this.#to);
    if (this.#cc.length) mailable.cc(this.#cc);
    if (this.#bcc.length) mailable.bcc(this.#bcc);
    if (this.#locale) mailable.locale(this.#locale);
  }

  #resolveMailer(): Mailer | undefined {
    if (!this.#mailerName) return undefined;
    return getNamedMailer(this.#mailerName);
  }

  async send(mailable: Mailable): Promise<void> {
    this.#apply(mailable);
    const named = this.#resolveMailer();
    if (named) {
      mailable.shouldQueue = false;
      await mailable.send(named);
      return;
    }
    await mail(mailable);
  }

  async queue(mailable: Mailable): Promise<void> {
    this.#apply(mailable);
    mailable.shouldQueue = true;
    await mail(mailable);
  }

  /** Queue after `delay` seconds (stored on the mailable for the worker). */
  async later(delay: number, mailable: Mailable): Promise<void> {
    this.#apply(mailable);
    mailable.delay = delay;
    mailable.shouldQueue = true;
    await mail(mailable);
  }
}
