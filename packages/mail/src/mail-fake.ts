import type { Mailer, MailMessage } from "@bunyad/contracts";
import {
  asAddressField,
  normalizeAddresses,
  type MailAddress,
} from "./addresses.ts";
import { ArrayMailer } from "./array-mailer.ts";
import {
  alwaysFromAddress,
  alwaysReplyToAddress,
  alwaysReturnPathAddress,
  alwaysToAddress,
  applyAlwaysDefaults,
  getMailer,
  mail as sendMail,
  registerMailer,
  setMailer,
  setMailQueue,
  type Mailable,
  type MailableConstructor,
} from "./mailable.ts";
import { PendingMail } from "./pending-mail.ts";

type SentPredicate = (message: MailMessage) => boolean;
type MailablePredicate = (mailable: Mailable) => boolean;

type MailableMatcher = MailableConstructor | string | string[];

/**
 * Records outbound mail (`Mail::fake()`).
 */
export class MailFake extends ArrayMailer {
  readonly mailables: Mailable[] = [];
  readonly queued: Mailable[] = [];

  recordSent(mailable: Mailable): void {
    this.mailables.push(mailable);
  }

  recordQueued(mailable: Mailable): void {
    this.queued.push(mailable);
  }

  assertSent(predicate: SentPredicate): void;
  assertSent(
    mailable: MailableMatcher,
    callback?: MailablePredicate | number,
  ): void;
  assertSent(
    predicateOrMatcher: SentPredicate | MailableMatcher,
    callbackOrCount?: MailablePredicate | number,
  ): void {
    if (isMessagePredicate(predicateOrMatcher)) {
      if (!this.messages.some(predicateOrMatcher)) {
        throw new Error("Expected a matching mail message to be sent.");
      }
      return;
    }

    let matches = filterMailables(this.mailables, predicateOrMatcher);
    if (typeof callbackOrCount === "number") {
      if (matches.length !== callbackOrCount) {
        throw new Error(
          `Expected mailable to be sent ${callbackOrCount} time(s), got ${matches.length}.`,
        );
      }
      return;
    }
    if (callbackOrCount) matches = matches.filter(callbackOrCount);
    if (matches.length === 0) {
      throw new Error("Expected a matching mailable to be sent.");
    }
  }

  assertNotSent(predicate: SentPredicate): void;
  assertNotSent(mailable: MailableMatcher): void;
  assertNotSent(predicateOrMatcher: SentPredicate | MailableMatcher): void {
    if (isMessagePredicate(predicateOrMatcher)) {
      if (this.messages.some(predicateOrMatcher)) {
        throw new Error("Unexpected matching mail message was sent.");
      }
      return;
    }
    if (filterMailables(this.mailables, predicateOrMatcher).length > 0) {
      throw new Error("Unexpected matching mailable was sent.");
    }
  }

  assertSentCount(count: number): void {
    if (this.messages.length !== count) {
      throw new Error(
        `Expected ${count} mail message(s), got ${this.messages.length}.`,
      );
    }
  }

  assertNothingSent(): void {
    this.assertSentCount(0);
    if (this.mailables.length > 0) {
      throw new Error("Unexpected mailables were sent.");
    }
  }

  assertQueued(
    mailable: MailableMatcher,
    callback?: MailablePredicate | number,
  ): void {
    let matches = filterMailables(this.queued, mailable);
    if (typeof callback === "number") {
      if (matches.length !== callback) {
        throw new Error(
          `Expected mailable to be queued ${callback} time(s), got ${matches.length}.`,
        );
      }
      return;
    }
    if (callback) matches = matches.filter(callback);
    if (matches.length === 0) {
      throw new Error("Expected a matching mailable to be queued.");
    }
  }

  assertNotQueued(mailable: MailableMatcher): void {
    if (filterMailables(this.queued, mailable).length > 0) {
      throw new Error("Unexpected matching mailable was queued.");
    }
  }

  assertQueuedCount(count: number): void {
    if (this.queued.length !== count) {
      throw new Error(
        `Expected ${count} queued mailable(s), got ${this.queued.length}.`,
      );
    }
  }

  assertNothingQueued(): void {
    this.assertQueuedCount(0);
  }
}

function isMailableConstructor(value: unknown): value is MailableConstructor {
  return (
    typeof value === "function" &&
    value.prototype != null &&
    typeof (value.prototype as { envelope?: unknown }).envelope === "function"
  );
}

function isMessagePredicate(
  value: SentPredicate | MailableMatcher,
): value is SentPredicate {
  return typeof value === "function" && !isMailableConstructor(value);
}

function filterMailables(
  list: Mailable[],
  matcher: MailableMatcher,
): Mailable[] {
  if (typeof matcher === "string") {
    return list.filter((m) => normalizeAddresses(m.envelope().to).includes(matcher));
  }
  if (Array.isArray(matcher)) {
    return list.filter((m) => {
      const to = normalizeAddresses(m.envelope().to);
      return matcher.every((addr) => to.includes(addr));
    });
  }
  return list.filter((m) => m instanceof matcher);
}

let previousMailer: Mailer | undefined;

function requireMailFake(): MailFake {
  const mailer = getMailer();
  if (!(mailer instanceof MailFake)) {
    throw new Error("Call Mail.fake() before asserting sent mail.");
  }
  return mailer;
}

function tryMailFake(): MailFake | undefined {
  try {
    const mailer = getMailer();
    return mailer instanceof MailFake ? mailer : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `Mail` facade.
 */
export const Mail = {
  async send(mailable: Mailable): Promise<void> {
    const fake = tryMailFake();
    if (fake) {
      if (mailable.shouldQueue) {
        fake.recordQueued(mailable);
        return;
      }
      fake.recordSent(mailable);
    }
    return sendMail(mailable);
  },

  async queue(mailable: Mailable): Promise<void> {
    mailable.shouldQueue = true;
    return Mail.send(mailable);
  },

  async later(delay: number, mailable: Mailable): Promise<void> {
    mailable.delay = delay;
    mailable.shouldQueue = true;
    return Mail.send(mailable);
  },

  async laterOn(queue: string, delay: number, mailable: Mailable): Promise<void> {
    mailable.queueName = queue;
    return Mail.later(delay, mailable);
  },

  async queueOn(queue: string, mailable: Mailable): Promise<void> {
    mailable.queueName = queue;
    return Mail.queue(mailable);
  },

  /** Set the queue name used by subsequent `queue` / `later` on a mailable. */
  onQueue(queue: string, mailable: Mailable): Promise<void> {
    mailable.queueName = queue;
    return Mail.queue(mailable);
  },

  async sendNow(mailable: Mailable): Promise<void> {
    mailable.shouldQueue = false;
    mailable.delay = undefined;
    return Mail.send(mailable);
  },

  async plain(
    text: string,
    to: MailAddress | MailAddress[],
    subject = "(no subject)",
  ): Promise<void> {
    return Mail.raw(text, to, subject);
  },

  async render(mailable: Mailable): Promise<string> {
    return mailable.render();
  },

  to(users: MailAddress | MailAddress[]): PendingMail {
    return new PendingMail().to(users);
  },

  cc(users: MailAddress | MailAddress[]): PendingMail {
    return new PendingMail().cc(users);
  },

  bcc(users: MailAddress | MailAddress[]): PendingMail {
    return new PendingMail().bcc(users);
  },

  mailer(name: string): PendingMail {
    return new PendingMail(name);
  },

  async raw(
    text: string,
    to: MailAddress | MailAddress[],
    subject = "(no subject)",
  ): Promise<void> {
    await getMailer().send(
      applyAlwaysDefaults({
        to: asAddressField(normalizeAddresses(to)) ?? "",
        subject,
        text,
      }),
    );
  },

  async html(
    html: string,
    to: MailAddress | MailAddress[],
    subject = "(no subject)",
  ): Promise<void> {
    await getMailer().send(
      applyAlwaysDefaults({
        to: asAddressField(normalizeAddresses(to)) ?? "",
        subject,
        html,
      }),
    );
  },

  alwaysFrom(address: string | null): void {
    alwaysFromAddress(address);
  },

  alwaysTo(address: string | null): void {
    alwaysToAddress(address);
  },

  alwaysReplyTo(address: string | null): void {
    alwaysReplyToAddress(address);
  },

  alwaysReturnPath(address: string | null): void {
    alwaysReturnPathAddress(address);
  },

  /** Register a named mailer for `Mail.mailer('smtp')`. */
  extend(name: string, mailer: Mailer): void {
    registerMailer(name, mailer);
  },

  /** Live the queue used for queued mailables. */
  setQueue(queue: Parameters<typeof setMailQueue>[0]): void {
    setMailQueue(queue);
  },

  fake(): MailFake {
    try {
      previousMailer = getMailer();
    } catch {
      previousMailer = undefined;
    }
    const fake = new MailFake();
    setMailer(fake);
    return fake;
  },

  assertSent(
    predicateOrMatcher: SentPredicate | MailableMatcher,
    callbackOrCount?: MailablePredicate | number,
  ): void {
    requireMailFake().assertSent(predicateOrMatcher as never, callbackOrCount);
  },

  assertNotSent(predicateOrMatcher: SentPredicate | MailableMatcher): void {
    requireMailFake().assertNotSent(predicateOrMatcher as never);
  },

  assertSentCount(count: number): void {
    requireMailFake().assertSentCount(count);
  },

  assertNothingSent(): void {
    requireMailFake().assertNothingSent();
  },

  assertQueued(
    mailable: MailableMatcher,
    callback?: MailablePredicate | number,
  ): void {
    requireMailFake().assertQueued(mailable, callback);
  },

  assertNotQueued(mailable: MailableMatcher): void {
    requireMailFake().assertNotQueued(mailable);
  },

  assertQueuedCount(count: number): void {
    requireMailFake().assertQueuedCount(count);
  },

  assertNothingQueued(): void {
    requireMailFake().assertNothingQueued();
  },

  /** Restore the mailer active before `Mail.fake()`. */
  restore(): void {
    if (previousMailer) setMailer(previousMailer);
  },
};
