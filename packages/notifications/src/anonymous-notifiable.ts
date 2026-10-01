import type { Notifiable, Notification, NotificationChannel } from "./notification.ts";

/**
 * On-demand notification recipient (`Notification.route(...)`).
 */
export class AnonymousNotifiable implements Notifiable {
  readonly routes: Partial<Record<NotificationChannel, string | string[]>> = {};

  route(channel: NotificationChannel | string, route: string | string[]): this {
    this.routes[channel as NotificationChannel] = route;
    return this;
  }

  /** Bulk-set on-demand routes (named `setRoutes` to avoid colliding with the `routes` property). */
  setRoutes(
    routes: Partial<Record<NotificationChannel | string, string | string[]>>,
  ): this {
    for (const [channel, route] of Object.entries(routes)) {
      if (route != null) this.route(channel, route);
    }
    return this;
  }

  routeNotificationFor(
    channel: NotificationChannel,
  ): string | string[] | undefined {
    return this.routes[channel];
  }

  get email(): string | undefined {
    const mail = this.routes.mail;
    if (mail == null) return undefined;
    const first = Array.isArray(mail) ? mail[0] : mail;
    if (!first) return undefined;
    const match = /^(.+?)\s*<([^>]+)>$/.exec(first);
    return match?.[2] ?? first;
  }

  get phone(): string | undefined {
    const sms = this.routes.sms ?? this.routes.vonage;
    if (sms == null) return undefined;
    return Array.isArray(sms) ? sms[0] : sms;
  }

  notify(notification: Notification): Promise<void> {
    const { notify } = require("./sender.ts") as typeof import("./sender.ts");
    return notify(this, notification);
  }

  notifyNow(notification: Notification): Promise<void> {
    const { getNotificationSender } =
      require("./sender.ts") as typeof import("./sender.ts");
    return getNotificationSender().sendNow(this, notification);
  }
}
