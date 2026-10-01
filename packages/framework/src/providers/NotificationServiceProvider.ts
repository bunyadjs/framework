import { ServiceProvider } from "@bunyad/core";
import type { Connection } from "@bunyad/database";
import {
  NotificationSender,
  setNotificationSender,
  SqliteDatabaseNotificationRepository,
  MemoryDatabaseNotificationRepository,
  HttpSmsSender,
} from "@bunyad/notifications";
import type { QueueManager } from "@bunyad/queue";

type ServicesConfig = {
  slack?: {
    webhook_url?: string;
    notifications?: { bot_user_oauth_token?: string };
  };
  vonage?: {
    sms_from?: string;
  };
  sms?: {
    url?: string;
    authorization?: string;
  };
};

export class NotificationServiceProvider extends ServiceProvider {
  register(): void {
    const connection = this.app.make<Connection>("db");
    const queue = this.app.make<QueueManager>("queue");
    const notificationDb =
      process.env.SESSION_DRIVER === "memory"
        ? new MemoryDatabaseNotificationRepository()
        : new SqliteDatabaseNotificationRepository({ connection });

    const services = this.app.config.get<ServicesConfig>("services") ?? {};
    const slackWebhook =
      services.slack?.webhook_url ??
      process.env.SLACK_WEBHOOK_URL ??
      undefined;
    const smsUrl =
      services.sms?.url ?? process.env.SMS_URL ?? process.env.VONAGE_SMS_URL;
    const smsAuth =
      services.sms?.authorization ??
      process.env.SMS_AUTHORIZATION ??
      (process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET
        ? `Basic ${btoa(`${process.env.VONAGE_API_KEY}:${process.env.VONAGE_API_SECRET}`)}`
        : undefined);

    setNotificationSender(
      new NotificationSender({
        database: notificationDb,
        queue,
        slack: slackWebhook,
        sms: smsUrl
          ? new HttpSmsSender({
              url: smsUrl,
              authorization: smsAuth,
            })
          : undefined,
      }),
    );
  }
}
