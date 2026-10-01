---
title: Notifications
description: Send short messages over mail, database, Slack, SMS, and broadcast channels.
---

# Notifications

## Introduction

Notifications are short messages about something that happened in your app — an invoice paid, a welcome email, a Slack alert. One class can deliver on several channels: `mail`, `database`, `slack`, `sms`, `vonage`, and `broadcast`.

You send with `notify()`, `Notification.send`, or `Notification.route(...).notify(...)`. Framework apps boot a `NotificationSender` from `NotificationServiceProvider` with a database inbox and the app queue.

```ts
import { notify } from "@bunyad/notifications";
import WelcomeNotification from "@/Notifications/WelcomeNotification.ts";
import User from "@/Models/User.ts";

const user = await User.find(1);
await notify(user!, new WelcomeNotification());
```

## Generating notifications

`make:notification` writes a class under `app/Notifications`, including a nested mailable for the mail channel:

```shell
bunyad make:notification InvoicePaid
```

That creates `app/Notifications/InvoicePaidNotification.ts`. You can also create the file by hand.

## Writing notifications

Extend `Notification`, list channels in `via`, and implement a builder per channel:

```ts
import { Mailable } from "@bunyad/mail";
import {
  Notification,
  routeNotificationForMail,
  type Notifiable,
  type NotificationChannel,
} from "@bunyad/notifications";
import WelcomeMail from "@/Mail/WelcomeMail.ts";

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
```

| Method | Channel |
| --- | --- |
| `toMail` | `mail` — return a `Mailable` or a `MailMessage` |
| `toDatabase` / `toArray` | `database` (and broadcast fallback payload) |
| `toSlack` | `slack` |
| `toSms` / `toVonage` | `sms` / `vonage` |
| `toBroadcast` | `broadcast` |
| `broadcastOn` | Channel name(s) for broadcast; defaults to routing helpers |

Optional `locale(name)` stores a preferred locale on the instance.

## Notifiables

Anything with an `id`, `email`, `phone` / `mobile`, and optional `routeNotificationFor` can receive notifications. Models usually add a `notifications()` helper that wraps `databaseNotifications`:

```ts
import { databaseNotifications } from "@bunyad/notifications";
import { Model } from "@bunyad/orm";

export default class User extends Model {
  declare email: string;

  get notificationType(): string {
    return "User";
  }

  notifications() {
    return databaseNotifications(this);
  }
}
```

Routing helpers resolve destinations:

```ts
import {
  routeNotificationForMail,
  routeNotificationForSlack,
  routeNotificationForSms,
  routeNotificationForBroadcast,
} from "@bunyad/notifications";

routeNotificationForMail(user); // routeNotificationFor("mail") or user.email
routeNotificationForSlack(user); // routeNotificationFor("slack") or sender default webhook
routeNotificationForSms(user); // routeNotificationFor("sms"|"vonage") or phone / mobile
routeNotificationForBroadcast(user); // routeNotificationFor("broadcast") or `${type}.${id}`
```

Override per model:

```ts
routeNotificationFor(channel: NotificationChannel) {
  if (channel === "mail") return this.email;
  if (channel === "slack") return process.env.SLACK_WEBHOOK_URL;
  if (channel === "sms") return this.phone;
  return undefined;
}
```

## Sending notifications

```ts
import { notify, Notification } from "@bunyad/notifications";
import InvoicePaid from "@/Notifications/InvoicePaidNotification.ts";

await notify(user, new InvoicePaid());
await Notification.send(user, new InvoicePaid());
await Notification.send([userA, userB], new InvoicePaid());
await Notification.sendNow(user, new InvoicePaid()); // skip the queue
```

### On-demand recipients

Send without a user model by routing channels explicitly:

```ts
await Notification.route("mail", "ada@example.com").notify(new InvoicePaid());

await Notification.routes({
  mail: "ada@example.com",
  slack: "https://hooks.slack.com/services/...",
  sms: "+15551212",
}).notify(new InvoicePaid());
```

`AnonymousNotifiable` also exposes `notify` and `notifyNow`.

### Queueing

Set `shouldQueue = true` on the notification. The sender must have been constructed with a `queue` (the framework provider passes the app queue manager):

```ts
export default class InvoicePaid extends Notification {
  shouldQueue = true;

  via() {
    return ["mail"] as const;
  }

  // ...
}
```

Queued jobs use the handler name `SendQueuedNotification`. `Notification.sendNow` always delivers immediately.

### Forcing channels

On the sender instance, `deliverVia` overrides `via()` for subsequent sends until you clear it by not calling it again on a fresh sender:

```ts
import { getNotificationSender } from "@bunyad/notifications";

getNotificationSender().deliverVia("mail", "database");
```

## Mail notifications

### MailMessage fluent builder

Return a `MailMessage` from `toMail` when you want a greeting, lines, and an action button without a separate mailable class:

```ts
import { MailMessage, Notification, type Notifiable } from "@bunyad/notifications";

export default class InvoicePaid extends Notification {
  toMail(notifiable: Notifiable) {
    return new MailMessage()
      .subject("Invoice Paid")
      .greeting("Hello!")
      .line("Your invoice has been paid.")
      .lineIf(true, "Amount: 10")
      .action("View invoice", "https://example.com/invoices/1")
      .success()
      .salutation("Thanks");
  }
}
```

Useful builders: `line`, `lines`, `lineIf`, `linesIf`, `error`, `level`, `from`, `replyTo`, `cc`, `bcc`, `to`, `attach`, `attachMany`, `attachData`, `tag`, `metadata`, `priority`, `mailer`, `when`, `unless`, `with`.

`MailMessage` renders a simple HTML body from greeting / lines / action. Attachments are read from disk or attached as raw data when the message is sent.

### Using a mailable

Prefer a dedicated `Mailable` when you need markdown views, embeds, or the full mail API:

```ts
toMail(notifiable: Notifiable) {
  return new InvoicePaidMail(routeNotificationForMail(notifiable));
}
```

The mail channel sends that mailable through `Mail.send`.

## Database notifications

The `database` channel stores a row for the notifiable. The framework provider uses `SqliteDatabaseNotificationRepository` against the default DB connection (or `MemoryDatabaseNotificationRepository` when `SESSION_DRIVER=memory`).

Create a `notifications` table:

```ts
import type { Schema } from "@bunyad/database";

export async function up(schema: Schema): Promise<void> {
  await schema.create("notifications", (table) => {
    table.string("id");
    table.string("type");
    table.string("notifiable_type");
    table.string("notifiable_id");
    table.text("data");
    table.string("read_at").nullable();
    table.timestamps();
  });
  await schema.raw(
    "CREATE UNIQUE INDEX notifications_id_unique ON notifications (id)",
  );
}
```

Implement `toDatabase` (or `toArray`). The notifiable must have an `id`. The stored `type` is the notification class name. `notifiableType` comes from `notificationType` or the constructor name.

Read the inbox:

```ts
const rows = await user.notifications().get();
const unread = await user.notifications().unreadCount();
await user.notifications().markAsRead(rows[0]!.id);
```

Each record includes `id`, `type`, `notifiableType`, `notifiableId`, `data`, `readAt`, and `createdAt`.

## Slack notifications

Return a `SlackMessage` from `toSlack`. Route a webhook URL with `routeNotificationFor("slack")`, or pass a default webhook string when constructing `NotificationSender`:

```ts
import {
  Notification,
  SlackMessage,
  type Notifiable,
} from "@bunyad/notifications";

export default class PaymentReceived extends Notification {
  via() {
    return ["slack"] as const;
  }

  toSlack(_notifiable: Notifiable) {
    return new SlackMessage()
      .text("Payment received")
      .from("Bunyad")
      .success()
      .headerBlock("Invoice paid")
      .sectionBlock((block) => block.text("*Amount:* $42"))
      .dividerBlock();
  }
}
```

Builders: `text` / `content`, `to` (channel override), `from`, `iconEmoji`, `iconUrl`, `warning`, `error`, `level`, `attachment`, `contextBlock`, `with` (raw payload fields).

Wire an HTTP sender (or keep the default in-memory `ArraySlackSender` for tests):

```ts
import {
  HttpSlackSender,
  NotificationSender,
  setNotificationSender,
} from "@bunyad/notifications";

setNotificationSender(
  new NotificationSender({
    slack: new HttpSlackSender(),
    // or slack: "https://hooks.slack.com/services/...",
  }),
);
```

## SMS notifications

Return an `SmsMessage` (or `VonageMessage`) from `toSms` / `toVonage`. The phone number comes from `routeNotificationFor("sms"|"vonage")`, `phone`, or `mobile`:

```ts
import {
  Notification,
  SmsMessage,
  VonageMessage,
  type Notifiable,
} from "@bunyad/notifications";

export default class OrderShipped extends Notification {
  via() {
    return ["sms"] as const;
  }

  toSms(_notifiable: Notifiable) {
    return new SmsMessage().content("Your order shipped.").from("BUNYAD");
  }
}

export default class AuthCode extends Notification {
  via() {
    return ["vonage"] as const;
  }

  toVonage(_notifiable: Notifiable) {
    return new VonageMessage().content("Your code is 999");
  }
}
```

Default sender is `ArraySmsSender` (records messages in memory). For production, pass `HttpSmsSender`:

```ts
import {
  HttpSmsSender,
  NotificationSender,
  setNotificationSender,
} from "@bunyad/notifications";

setNotificationSender(
  new NotificationSender({
    sms: new HttpSmsSender({
      url: process.env.SMS_API_URL!,
      authorization: process.env.SMS_API_TOKEN,
      buildBody: (to, message) => ({
        to,
        from: message.getFrom(),
        text: message.getContent(),
      }),
    }),
  }),
);
```

## Broadcast notifications

The `broadcast` channel pushes through the app broadcaster (`getBroadcaster` from `@bunyad/broadcasting`). Return a `BroadcastMessage`, and optionally set channel names with `broadcastOn`:

```ts
import {
  BroadcastMessage,
  Notification,
  type Notifiable,
} from "@bunyad/notifications";

export default class InvoicePaid extends Notification {
  via() {
    return ["broadcast"] as const;
  }

  toBroadcast(_notifiable: Notifiable) {
    return new BroadcastMessage({ invoice_id: 42 }).event("invoice.paid");
  }

  broadcastOn(notifiable: Notifiable) {
    return `App.Models.User.${notifiable.id}`;
  }
}
```

When `broadcastOn` returns nothing, the default channel is `${notificationType}.${id}` (for example `User.7`). Without `toBroadcast`, the payload falls back to `toArray` / `toDatabase`.

## Custom channels

Register an extra channel on the sender:

```ts
import { getNotificationSender } from "@bunyad/notifications";

getNotificationSender().extend("mail", async (notifiable, notification) => {
  // replace or wrap the built-in mail handler
});

getNotificationSender().channel("mail", async (notifiable, notification) => {
  // same as extend
});
```

## Configuration without the framework

```ts
import {
  MemoryDatabaseNotificationRepository,
  NotificationSender,
  setNotificationSender,
} from "@bunyad/notifications";
import { ArrayMailer, setMailer } from "@bunyad/mail";

setMailer(new ArrayMailer());
setNotificationSender(
  new NotificationSender({
    database: new MemoryDatabaseNotificationRepository(),
  }),
);
```

## Testing

`Notification.fake()` swaps the sender for a recorder:

```ts
import { Notification } from "@bunyad/notifications";
import WelcomeNotification from "@/Notifications/WelcomeNotification.ts";

const fake = Notification.fake();

await notify(user, new WelcomeNotification());

Notification.assertSentTo(user, WelcomeNotification);
Notification.assertSentTo(user, WelcomeNotification, (n, notifiable) => {
  return notifiable.email === "ada@example.com";
});
Notification.assertSentTimes(WelcomeNotification, 1);
Notification.assertCount(1);
Notification.assertNotSentTo(user, OtherNotification);
Notification.assertNothingSent();

await Notification.route("mail", "on-demand@example.com").notify(
  new WelcomeNotification(),
);
Notification.assertSentOnDemand(WelcomeNotification);
Notification.assertNotSentOnDemand(OtherNotification);

fake.restore();
```

`fake.sent(WelcomeNotification)` returns the recorded `{ notifiable, notification }` pairs when you want to inspect them directly.
