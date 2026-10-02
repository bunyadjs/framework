# @bunyad/notifications

Multi-channel notifications for Bunyad: one class that can deliver by mail, database inbox, Slack, SMS (generic or Vonage) and broadcast, with queueing and test fakes.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/notifications@beta
# or: npm install @bunyad/notifications@beta
```

## Usage

```ts
import { ArrayMailer, setMailer } from "@bunyad/mail";
import {
  Notification, MailMessage, notify, databaseNotifications, setNotificationSender,
  NotificationSender, MemoryDatabaseNotificationRepository,
  type Notifiable, type NotificationChannel,
} from "@bunyad/notifications";

class InvoicePaid extends Notification {
  via(): NotificationChannel[] { return ["mail", "database"]; }
  toMail() {
    return new MailMessage().subject("Paid").greeting("Hello!").line("Invoice paid")
      .action("View invoice", "https://example.com/i/1");
  }
  toDatabase() { return { invoiceId: 1 }; }
}

const mailer = new ArrayMailer();
setMailer(mailer);
const database = new MemoryDatabaseNotificationRepository();
setNotificationSender(new NotificationSender({ database }));

const user: Notifiable = { id: 5, email: "ada@example.com", notificationType: "User" };
await notify(user, new InvoicePaid());
console.log(mailer.messages[0]!.subject, mailer.messages[0]!.to); // Paid ada@example.com

const inbox = databaseNotifications(user);
console.log(await inbox.unreadCount()); // 1
const [row] = await inbox.get();
console.log(row!.data);                 // { invoiceId: 1 }
await inbox.markAsRead(row!.id);
console.log(await inbox.unreadCount()); // 0

// In tests, record instead of sending
const fake = Notification.fake();
await notify(user, new InvoicePaid());
Notification.assertSentTo(user, InvoicePaid);
fake.restore();
```

## Notes

- Runs on Bun only (1.4 or newer). Depends on `@bunyad/mail` and `@bunyad/broadcasting`; install `@bunyad/queue` if notifications set `shouldQueue = true` and you pass a `queue` to `NotificationSender`.
- Channels: `mail`, `database`, `slack`, `sms`, `vonage`, `broadcast`. Each maps to a `toMail` / `toDatabase` / `toSlack` / `toSms` / `toVonage` / `toBroadcast` method.
- Database inbox: `MemoryDatabaseNotificationRepository` or `SqliteDatabaseNotificationRepository`.
- Slack and SMS delivery use `HttpSlackSender` / `HttpSmsSender`; `ArraySlackSender` / `ArraySmsSender` collect messages for tests.

## License

MIT
