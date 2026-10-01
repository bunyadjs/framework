import type { Notification } from "./notification.ts";
import type { Notifiable } from "./notification.ts";
import {
  databaseNotifications,
  getNotificationSender,
  notify,
} from "./sender.ts";

export type NotifiableMethods = {
  notify(notification: Notification): Promise<void>;
  notifyNow(notification: Notification): Promise<void>;
  notifications(): ReturnType<typeof databaseNotifications>;
};

/**
 * Prototype methods for models that receive notifications
 * (`$user->notify()`, `$user->notifyNow()`, `$user->notifications()`).
 */
export const NotifiableTrait: NotifiableMethods = {
  notify(this: Notifiable, notification: Notification): Promise<void> {
    return notify(this, notification);
  },
  notifyNow(this: Notifiable, notification: Notification): Promise<void> {
    return getNotificationSender().sendNow(this, notification);
  },
  notifications(this: Notifiable) {
    return databaseNotifications(this);
  },
};

/**
 * Copy `notify` / `notifyNow` / `notifications` onto a model class prototype.
 *
 * ```ts
 * class User extends Model {}
 * applyNotifiable(User);
 * await new User().notify(new InvoicePaid());
 * ```
 */
export function applyNotifiable<T extends { prototype: object }>(Model: T): T {
  Object.assign(Model.prototype, NotifiableTrait);
  return Model;
}
