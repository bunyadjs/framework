import {
  NotificationSender,
  getNotificationSender,
  setNotificationSender,
} from "./sender.ts";
import { AnonymousNotifiable } from "./anonymous-notifiable.ts";
import type { Notifiable } from "./notification.ts";
import { Notification } from "./notification.ts";

export type SentNotification = {
  notifiable: Notifiable;
  notification: Notification;
};

type NotificationType = abstract new (...args: never[]) => Notification;

type SentPredicate = (notification: Notification, notifiable: Notifiable) => boolean;

function matchesNotifiable(a: Notifiable, b: Notifiable): boolean {
  if (a.id != null && b.id != null) return String(a.id) === String(b.id);
  if (a.email != null && b.email != null) return String(a.email) === String(b.email);
  return a === b;
}

function matchesType(
  notification: Notification,
  type: NotificationType | string,
): boolean {
  if (typeof type === "string") return notification.constructor.name === type;
  return notification.constructor === type;
}

/**
 * Records notifications instead of sending them (Laravel `Notification::fake()`).
 */
export class NotificationFake extends NotificationSender {
  readonly #sent: SentNotification[] = [];
  readonly #previous?: NotificationSender;

  constructor(previous?: NotificationSender) {
    super();
    this.#previous = previous;
  }

  override async send(
    notifiable: Notifiable,
    notification: Notification,
  ): Promise<void> {
    this.#sent.push({ notifiable, notification });
  }

  override async sendNow(
    notifiable: Notifiable,
    notification: Notification,
  ): Promise<void> {
    this.#sent.push({ notifiable, notification });
  }

  sent(type?: NotificationType | string): SentNotification[] {
    if (!type) return [...this.#sent];
    return this.#sent.filter((s) => matchesType(s.notification, type));
  }

  assertSentTo(
    notifiable: Notifiable,
    type: NotificationType | string,
    predicate?: SentPredicate,
  ): void {
    const matches = this.#sent.filter(
      (s) =>
        matchesNotifiable(s.notifiable, notifiable) &&
        matchesType(s.notification, type),
    );
    const found = predicate
      ? matches.some((s) => predicate(s.notification, s.notifiable))
      : matches.length > 0;
    if (!found) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(
        `Expected notification [${label}] to be sent to the given notifiable.`,
      );
    }
  }

  assertNotSentTo(
    notifiable: Notifiable,
    type: NotificationType | string,
  ): void {
    const matches = this.#sent.filter(
      (s) =>
        matchesNotifiable(s.notifiable, notifiable) &&
        matchesType(s.notification, type),
    );
    if (matches.length > 0) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(
        `Unexpected notification [${label}] was sent to the given notifiable.`,
      );
    }
  }

  assertSentTimes(type: NotificationType | string, times: number): void {
    const count = this.sent(type).length;
    if (count !== times) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(
        `Expected notification [${label}] to be sent ${times} time(s), got ${count}.`,
      );
    }
  }

  assertCount(count: number): void {
    if (this.#sent.length !== count) {
      throw new Error(
        `Expected ${count} notification(s), got ${this.#sent.length}.`,
      );
    }
  }

  /** Laravel `Notification::assertSentOnDemand` — sent via `Notification.route(...)`. */
  assertSentOnDemand(
    type: NotificationType | string,
    predicate?: SentPredicate,
  ): void {
    const matches = this.#sent.filter(
      (s) =>
        s.notifiable instanceof AnonymousNotifiable &&
        matchesType(s.notification, type),
    );
    const found = predicate
      ? matches.some((s) => predicate(s.notification, s.notifiable))
      : matches.length > 0;
    if (!found) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(
        `Expected notification [${label}] to be sent on demand.`,
      );
    }
  }

  assertNotSentOnDemand(type: NotificationType | string): void {
    const matches = this.#sent.filter(
      (s) =>
        s.notifiable instanceof AnonymousNotifiable &&
        matchesType(s.notification, type),
    );
    if (matches.length > 0) {
      const label = typeof type === "string" ? type : type.name;
      throw new Error(
        `Unexpected on-demand notification [${label}] was sent.`,
      );
    }
  }

  assertNothingSent(): void {
    this.assertCount(0);
  }

  restore(): void {
    if (this.#previous) setNotificationSender(this.#previous);
  }
}

export function requireNotificationFake(): NotificationFake {
  const sender = getNotificationSender();
  if (!(sender instanceof NotificationFake)) {
    throw new Error("Call Notification.fake() before asserting sent notifications.");
  }
  return sender;
}

export function fakeNotification(): NotificationFake {
  const previous = getNotificationSender();
  const fake = new NotificationFake(previous);
  setNotificationSender(fake);
  return fake;
}
