import { Mailable } from "@bunyad/mail";
import {
  Notification,
  routeNotificationForMail,
  type Notifiable,
  type NotificationChannel,
} from "@bunyad/notifications";
import WelcomeMail from "../Mail/WelcomeMail.ts";

export default class WelcomeNotification extends Notification {
  via(): NotificationChannel[] {
    return ["mail", "database"];
  }

  toMail(notifiable: Notifiable): Mailable {
    return new WelcomeMail(routeNotificationForMail(notifiable));
  }

  toDatabase(notifiable: Notifiable): Record<string, unknown> {
    return {
      message: `Welcome, ${routeNotificationForMail(notifiable)}!`,
    };
  }
}
