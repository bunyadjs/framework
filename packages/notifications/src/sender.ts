import { Mail, getMailer, type Mailable } from "@bunyad/mail";
import type {
  DatabaseNotificationRecord,
  DatabaseNotificationRepository,
} from "./database-repository.ts";
import { BroadcastMessage } from "./messages/broadcast-message.ts";
import { MailMessage } from "./messages/mail-message.ts";
import type {
  Notifiable,
  Notification,
  NotificationChannel,
} from "./notification.ts";
import {
  ArraySlackSender,
  HttpSlackSender,
  type SlackSender,
} from "./slack-sender.ts";
import { ArraySmsSender, type SmsSender } from "./sms-sender.ts";

export type NotificationChannelHandler = (
  notifiable: Notifiable,
  notification: Notification,
) => void | Promise<void>;

/** Minimal queue surface — satisfied by `@bunyad/queue` `QueueManager`. */
export type NotificationQueue = {
  push(name: string, data: unknown, queue?: string): Promise<string>;
  register(name: string, handler: (data: unknown) => void | Promise<void>): unknown;
};

export type NotificationSenderOptions = {
  database?: DatabaseNotificationRepository;
  /** When set, notifications with `shouldQueue` are deferred. */
  queue?: NotificationQueue;
  /** Slack webhook sender, or a default webhook URL string. */
  slack?: SlackSender | string;
  /** SMS / Vonage-style sender. */
  sms?: SmsSender;
};

export const SEND_QUEUED_NOTIFICATION = "SendQueuedNotification";

export type NotificationConstructor = new (
  ...args: never[]
) => Notification;

type SerializedNotifiable = {
  id?: string | number;
  email?: unknown;
  phone?: unknown;
  mobile?: unknown;
  notificationType?: string;
  routes?: Partial<Record<string, string | string[]>>;
};

export type QueuedNotificationPayload =
  | {
      kind: "live";
      notifiable: Notifiable;
      notification: Notification;
    }
  | {
      kind: "serialized";
      notifiable: SerializedNotifiable;
      notification: { name: string; props: Record<string, unknown> };
    };

const notificationRegistry = new Map<string, NotificationConstructor>();

/** Register a notification class so queued jobs can revive it by name. */
export function registerNotification(Ctor: NotificationConstructor): void {
  notificationRegistry.set(Ctor.name, Ctor);
}

export function getRegisteredNotification(
  name: string,
): NotificationConstructor | undefined {
  return notificationRegistry.get(name);
}

export function clearNotificationRegistry(): void {
  notificationRegistry.clear();
}

function plainProps(instance: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(instance)) {
    out[key] = (instance as Record<string, unknown>)[key];
  }
  return out;
}

function serializeNotifiable(notifiable: Notifiable): SerializedNotifiable {
  const routes: SerializedNotifiable["routes"] = {};
  for (const channel of [
    "mail",
    "database",
    "slack",
    "sms",
    "vonage",
    "broadcast",
  ] as NotificationChannel[]) {
    const routed = notifiable.routeNotificationFor?.(channel);
    if (routed != null) routes[channel] = routed;
  }
  return {
    id: notifiable.id,
    email: notifiable.email,
    phone: notifiable.phone,
    mobile: notifiable.mobile,
    notificationType: notifiable.notificationType,
    routes: Object.keys(routes).length ? routes : undefined,
  };
}

function reviveNotifiable(data: SerializedNotifiable): Notifiable {
  return {
    id: data.id,
    email: data.email,
    phone: data.phone,
    mobile: data.mobile,
    notificationType: data.notificationType,
    routeNotificationFor(channel) {
      return data.routes?.[channel];
    },
  };
}

function hydrateNotification(
  Ctor: NotificationConstructor,
  props: Record<string, unknown>,
): Notification {
  const instance = Object.create(Ctor.prototype) as Notification;
  Object.assign(instance, props);
  return instance;
}

/**
 * Send notifications across channels.
 */
export class NotificationSender {
  readonly #channels = new Map<NotificationChannel, NotificationChannelHandler>();
  readonly #database?: DatabaseNotificationRepository;
  readonly #queue?: NotificationQueue;
  readonly #slack: SlackSender;
  readonly #defaultSlackWebhook?: string;
  readonly #sms: SmsSender;
  #locale?: string;
  #deliverVia: NotificationChannel[] | undefined;

  constructor(options: NotificationSenderOptions = {}) {
    this.#database = options.database;
    this.#queue = options.queue;

    if (typeof options.slack === "string") {
      this.#defaultSlackWebhook = options.slack;
      this.#slack = new HttpSlackSender();
    } else {
      this.#slack = options.slack ?? new ArraySlackSender();
    }
    this.#sms = options.sms ?? new ArraySmsSender();

    if (this.#queue) {
      this.#queue.register(SEND_QUEUED_NOTIFICATION, async (data) => {
        await this.#handleQueued(data);
      });
    }

    this.#channels.set("mail", async (notifiable, notification) => {
      if (!notification.toMail) {
        throw new Error(
          `Notification [${notification.constructor.name}] missing toMail().`,
        );
      }
      const built = notification.toMail(notifiable);
      if (built instanceof MailMessage) {
        await getMailer().send(await built.toMessage(notifiable));
        return;
      }
      await Mail.send(built as Mailable);
    });

    this.#channels.set("database", async (notifiable, notification) => {
      if (!this.#database) {
        throw new Error("Database notification repository is not configured.");
      }
      if (notifiable.id == null) {
        throw new Error("Notifiable must have an id for the database channel.");
      }
      const data =
        notification.toDatabase?.(notifiable) ??
        notification.toArray?.(notifiable);
      if (!data) {
        throw new Error(
          `Notification [${notification.constructor.name}] missing toDatabase()/toArray().`,
        );
      }
      await this.#database.store({
        id: crypto.randomUUID(),
        type: notification.constructor.name,
        notifiableType:
          notifiable.notificationType ??
          notifiable.constructor?.name ??
          "User",
        notifiableId: notifiable.id,
        data,
      });
    });

    this.#channels.set("slack", async (notifiable, notification) => {
      if (!notification.toSlack) {
        throw new Error(
          `Notification [${notification.constructor.name}] missing toSlack().`,
        );
      }
      const message = notification.toSlack(notifiable);
      const webhook = routeNotificationForSlack(
        notifiable,
        this.#defaultSlackWebhook,
      );
      await this.#slack.send(webhook, message);
    });

    const sendSms = async (
      notifiable: Notifiable,
      notification: Notification,
    ) => {
      const message =
        notification.toSms?.(notifiable) ??
        notification.toVonage?.(notifiable);
      if (!message) {
        throw new Error(
          `Notification [${notification.constructor.name}] missing toSms()/toVonage().`,
        );
      }
      const to = routeNotificationForSms(notifiable);
      await this.#sms.send(to, message);
    };

    this.#channels.set("sms", sendSms);
    this.#channels.set("vonage", sendSms);

    this.#channels.set("broadcast", async (notifiable, notification) => {
      const message =
        notification.toBroadcast?.(notifiable) ??
        fallbackBroadcastMessage(notification, notifiable);
      const on = notification.broadcastOn(notifiable);
      const channels =
        (Array.isArray(on) ? on : on ? [on] : []).filter(Boolean).length > 0
          ? (Array.isArray(on) ? on : [on]).map(String)
          : routeNotificationForBroadcast(notifiable);
      const { getBroadcaster } = await import("@bunyad/broadcasting");
      await getBroadcaster().broadcast(
        channels,
        message.eventName(notification.constructor.name),
        {
          type: notification.constructor.name,
          ...message.data,
        },
      );
    });
  }

  async #handleQueued(data: unknown): Promise<void> {
    const payload = data as QueuedNotificationPayload;
    if (payload.kind === "serialized") {
      const Ctor = notificationRegistry.get(payload.notification.name);
      if (!Ctor) {
        throw new Error(
          `Notification [${payload.notification.name}] is not registered. Call registerNotification().`,
        );
      }
      const notification = hydrateNotification(
        Ctor,
        payload.notification.props,
      );
      await this.sendNow(reviveNotifiable(payload.notifiable), notification);
      return;
    }
    // Backward-compatible: raw live payload without kind
    const live = payload as {
      kind?: string;
      notifiable: Notifiable;
      notification: Notification;
    };
    await this.sendNow(live.notifiable, live.notification);
  }

  get database(): DatabaseNotificationRepository | undefined {
    return this.#database;
  }

  get slackSender(): SlackSender {
    return this.#slack;
  }

  get smsSender(): SmsSender {
    return this.#sms;
  }

  channel(name: NotificationChannel, handler: NotificationChannelHandler): this {
    this.#channels.set(name, handler);
    return this;
  }

  /** Force delivery through these channels (overrides `via()`). */
  deliverVia(...channels: NotificationChannel[]): this {
    this.#deliverVia = channels;
    return this;
  }

  /** Channels currently forced by {@link deliverVia}. */
  deliversVia(): NotificationChannel[] | undefined {
    return this.#deliverVia ? [...this.#deliverVia] : undefined;
  }

  /** Default locale applied when sending. */
  locale(locale?: string): this | string | undefined {
    if (locale === undefined) return this.#locale;
    this.#locale = locale;
    return this;
  }

  driver(name: NotificationChannel): NotificationChannelHandler | undefined {
    return this.#channels.get(name);
  }

  extend(
    name: NotificationChannel,
    handler: NotificationChannelHandler,
  ): this {
    return this.channel(name, handler);
  }

  /** Send immediately (skips queue). */
  async sendNow(
    notifiable: Notifiable,
    notification: Notification,
  ): Promise<void> {
    if (this.#locale != null && notification.locale() == null) {
      notification.locale(this.#locale);
    }
    const channels = this.#deliverVia ?? notification.via(notifiable);
    for (const name of channels) {
      const handler = this.#channels.get(name);
      if (!handler) {
        throw new Error(`Notification channel [${name}] is not configured.`);
      }
      await handler(notifiable, notification);
    }
  }

  async send(
    notifiable: Notifiable,
    notification: Notification,
  ): Promise<void> {
    if (notification.shouldQueue) {
      if (!this.#queue) {
        throw new Error(
          "Queued notification requires NotificationSender({ queue }).",
        );
      }
      const name = notification.constructor.name;
      const payload: QueuedNotificationPayload = notificationRegistry.has(name)
        ? {
            kind: "serialized",
            notifiable: serializeNotifiable(notifiable),
            notification: { name, props: plainProps(notification) },
          }
        : {
            kind: "live",
            notifiable,
            notification,
          };
      await this.#queue.push(SEND_QUEUED_NOTIFICATION, payload);
      return;
    }
    await this.sendNow(notifiable, notification);
  }
}

let defaultSender: NotificationSender | undefined;

export function setNotificationSender(sender: NotificationSender): void {
  defaultSender = sender;
}

export function getNotificationSender(): NotificationSender {
  return defaultSender ?? (defaultSender = new NotificationSender());
}

/** `$user->notify()`. */
export function notify(
  notifiable: Notifiable,
  notification: Notification,
): Promise<void> {
  return getNotificationSender().send(notifiable, notification);
}

/** `$user->notifications` database inbox. */
export function databaseNotifications(notifiable: Notifiable) {
  const repo = getNotificationSender().database;
  const type =
    notifiable.notificationType ??
    (notifiable.constructor as { name: string }).name;
  const id = notifiable.id!;

  return {
    get: (): Promise<DatabaseNotificationRecord[]> =>
      repo ? repo.forNotifiable(type, id) : Promise.resolve([]),
    unreadCount: (): Promise<number> =>
      repo ? repo.unreadCount(type, id) : Promise.resolve(0),
    markAsRead: (notificationId: string): Promise<boolean> =>
      repo?.markAsRead(notificationId) ?? Promise.resolve(false),
  };
}

/** Resolve mail address for a notifiable. */
export function routeNotificationForMail(notifiable: Notifiable): string {
  const custom = notifiable.routeNotificationFor?.("mail");
  if (custom) return Array.isArray(custom) ? String(custom[0]) : custom;
  if (notifiable.email != null) return String(notifiable.email);
  throw new Error("Notifiable has no mail route.");
}

/** Resolve Slack webhook URL. */
export function routeNotificationForSlack(
  notifiable: Notifiable,
  fallbackWebhook?: string,
): string {
  const custom = notifiable.routeNotificationFor?.("slack");
  if (custom) return Array.isArray(custom) ? String(custom[0]) : custom;
  if (fallbackWebhook) return fallbackWebhook;
  throw new Error("Notifiable has no Slack webhook route.");
}

/** Resolve SMS / Vonage phone number. */
export function routeNotificationForSms(notifiable: Notifiable): string {
  const custom =
    notifiable.routeNotificationFor?.("sms") ??
    notifiable.routeNotificationFor?.("vonage");
  if (custom) return Array.isArray(custom) ? String(custom[0]) : custom;
  if (notifiable.phone != null) return String(notifiable.phone);
  if (notifiable.mobile != null) return String(notifiable.mobile);
  throw new Error("Notifiable has no SMS route.");
}

/** Resolve broadcast channel name(s). */
export function routeNotificationForBroadcast(notifiable: Notifiable): string[] {
  const custom = notifiable.routeNotificationFor?.("broadcast");
  if (custom) return Array.isArray(custom) ? custom.map(String) : [String(custom)];
  if (notifiable.id == null) {
    throw new Error("Notifiable must have an id for the broadcast channel.");
  }
  const type =
    notifiable.notificationType ??
    (notifiable.constructor as { name?: string }).name ??
    "User";
  return [`${type}.${notifiable.id}`];
}

function fallbackBroadcastMessage(
  notification: Notification,
  notifiable: Notifiable,
): BroadcastMessage {
  const data =
    notification.toArray?.(notifiable) ??
    notification.toDatabase?.(notifiable) ??
    {};
  return new BroadcastMessage(data);
}
