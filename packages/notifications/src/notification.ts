import type { Mailable } from "@bunyad/mail";
import { AnonymousNotifiable } from "./anonymous-notifiable.ts";
import type { BroadcastMessage } from "./messages/broadcast-message.ts";
import type { MailMessage } from "./messages/mail-message.ts";
import type { SlackMessage } from "./messages/slack-message.ts";
import type { SmsMessage, VonageMessage } from "./messages/sms-message.ts";
import type { NotificationFake } from "./notification-fake.ts";

export type NotificationChannel =
  | "mail"
  | "database"
  | "slack"
  | "sms"
  | "vonage"
  | "broadcast";

/**
 * Entity that can receive notifications (User, etc.).
 */
export type Notifiable = {
  id?: string | number;
  email?: unknown;
  /** Phone number for SMS / Vonage routing. */
  phone?: unknown;
  mobile?: unknown;
  /** Morph type for database notifications (defaults to constructor name). */
  notificationType?: string;
  routeNotificationFor?(
    channel: NotificationChannel,
  ): string | string[] | undefined;
};

type NotificationType = abstract new (...args: never[]) => Notification;

type SentPredicate = (
  notification: Notification,
  notifiable: Notifiable,
) => boolean;

/**
 * Multi-channel notification (`via` + `toMail` / `toArray` / …).
 */
export abstract class Notification {
  /**
   * When true, `notify()` pushes a queue job instead of sending inline.
   * Requires `NotificationSender({ queue })`.
   */
  shouldQueue = false;

  #locale?: string;

  /** Channels to deliver on. */
  via(_notifiable: Notifiable): NotificationChannel[] {
    return ["mail"];
  }

  /** Build a mailable / mail message when `mail` is in `via()`. */
  toMail?(_notifiable: Notifiable): Mailable | MailMessage;

  /** Payload stored in the database channel. */
  toDatabase?(_notifiable: Notifiable): Record<string, unknown>;

  /** Alias used for database / broadcast payloads; falls back to `toDatabase`. */
  toArray?(notifiable: Notifiable): Record<string, unknown>;

  /** Slack Incoming Webhook message. */
  toSlack?(_notifiable: Notifiable): SlackMessage;

  /** SMS message (`sms` channel). */
  toSms?(_notifiable: Notifiable): SmsMessage;

  /** SMS message (`vonage` channel) — falls back to `toSms`. */
  toVonage?(_notifiable: Notifiable): VonageMessage | SmsMessage;

  /** Real-time broadcast payload. */
  toBroadcast?(_notifiable: Notifiable): BroadcastMessage;

  /** Broadcast channel name(s) for this notification. */
  broadcastOn(_notifiable: Notifiable): string | string[] {
    return [];
  }

  /** Preferred locale for this notification instance. */
  locale(locale?: string): this | string | undefined {
    if (locale === undefined) return this.#locale;
    this.#locale = locale;
    return this;
  }

  /** `Notification.fake()`. */
  static fake(): NotificationFake {
    return loadFake().fakeNotification();
  }

  /** Send to one or many notifiables (respects `shouldQueue`). */
  static async send(
    notifiables: Notifiable | Notifiable[],
    notification: Notification,
  ): Promise<void> {
    const list = Array.isArray(notifiables) ? notifiables : [notifiables];
    const { notify } = loadSender();
    for (const notifiable of list) {
      await notify(notifiable, notification);
    }
  }

  /** Send immediately, skipping the queue. */
  static async sendNow(
    notifiables: Notifiable | Notifiable[],
    notification: Notification,
  ): Promise<void> {
    const list = Array.isArray(notifiables) ? notifiables : [notifiables];
    const { getNotificationSender } = loadSender();
    const sender = getNotificationSender();
    for (const notifiable of list) {
      await sender.sendNow(notifiable, notification);
    }
  }

  /** On-demand routing: `Notification.route('mail', 'a@b.c').notify(...)`. */
  static route(
    channel: NotificationChannel | string,
    route: string | string[],
  ): AnonymousNotifiable {
    return new AnonymousNotifiable().route(channel, route);
  }

  /** Set multiple on-demand routes at once. */
  static routes(
    routes: Partial<Record<NotificationChannel | string, string | string[]>>,
  ): AnonymousNotifiable {
    return new AnonymousNotifiable().setRoutes(routes);
  }

  static assertSentTo(
    notifiable: Notifiable,
    type: NotificationType | string,
    predicate?: SentPredicate,
  ): void {
    loadFake().requireNotificationFake().assertSentTo(notifiable, type, predicate);
  }

  static assertNotSentTo(
    notifiable: Notifiable,
    type: NotificationType | string,
  ): void {
    loadFake().requireNotificationFake().assertNotSentTo(notifiable, type);
  }

  static assertSentTimes(
    type: NotificationType | string,
    times: number,
  ): void {
    loadFake().requireNotificationFake().assertSentTimes(type, times);
  }

  static assertCount(count: number): void {
    loadFake().requireNotificationFake().assertCount(count);
  }

  static assertSentOnDemand(
    type: NotificationType | string,
    predicate?: SentPredicate,
  ): void {
    loadFake().requireNotificationFake().assertSentOnDemand(type, predicate);
  }

  static assertNotSentOnDemand(type: NotificationType | string): void {
    loadFake().requireNotificationFake().assertNotSentOnDemand(type);
  }

  static assertNothingSent(): void {
    loadFake().requireNotificationFake().assertNothingSent();
  }
}

/** Marker interface for queued notifications (optional alternative to `shouldQueue`). */
export interface ShouldQueue {
  shouldQueue: true;
}

function loadFake(): typeof import("./notification-fake.ts") {
  // Lazy require breaks the circular init with notification-fake.ts.
  return require("./notification-fake.ts") as typeof import("./notification-fake.ts");
}

function loadSender(): typeof import("./sender.ts") {
  return require("./sender.ts") as typeof import("./sender.ts");
}
