import { expect, test } from "bun:test";
import { ArrayMailer, Mailable, setMailer } from "@bunyad/mail";
import {
  Notification,
  notify,
  databaseNotifications,
  setNotificationSender,
  NotificationSender,
  MemoryDatabaseNotificationRepository,
  type Notifiable,
  type NotificationChannel,
} from "../src/index.ts";

class HelloMail extends Mailable {
  constructor(readonly email: string) {
    super();
  }
  envelope() {
    return { to: this.email, subject: "Hi" };
  }
  content() {
    return { text: "Hello" };
  }
}

class HelloNotification extends Notification {
  toMail(notifiable: Notifiable) {
    return new HelloMail(String(notifiable.email));
  }
}

class InboxNotification extends Notification {
  via(): NotificationChannel[] {
    return ["database"];
  }

  toDatabase() {
    return { body: "You have mail" };
  }
}

test("notify sends mail channel", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);
  setNotificationSender(new NotificationSender());

  await notify({ email: "ada@example.com" }, new HelloNotification());
  expect(mailer.messages).toHaveLength(1);
  expect(mailer.messages[0]!.to).toBe("ada@example.com");
});

test("notify database channel stores inbox row", async () => {
  const database = new MemoryDatabaseNotificationRepository();
  setNotificationSender(new NotificationSender({ database }));

  await notify(
    { id: 1, notificationType: "User", email: "a@b.c" },
    new InboxNotification(),
  );

  const rows = await database.forNotifiable("User", 1);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.data).toEqual({ body: "You have mail" });
  expect(await database.unreadCount("User", 1)).toBe(1);
  expect(await database.markAsRead(rows[0]!.id)).toBe(true);
  expect(await database.unreadCount("User", 1)).toBe(0);
});

test("shouldQueue defers until queue work()", async () => {
  const { QueueManager } = await import("@bunyad/queue");
  const database = new MemoryDatabaseNotificationRepository();
  const queue = new QueueManager({ connection: "memory" });

  class QueuedInbox extends Notification {
    shouldQueue = true;
    via(): NotificationChannel[] {
      return ["database"];
    }
    toDatabase() {
      return { body: "later" };
    }
  }

  setNotificationSender(new NotificationSender({ database, queue }));
  await notify({ id: 2, notificationType: "User" }, new QueuedInbox());
  expect(await database.forNotifiable("User", 2)).toHaveLength(0);

  await queue.work();
  expect(await database.forNotifiable("User", 2)).toHaveLength(1);
});

test("databaseNotifications reads inbox for notifiable", async () => {
  const database = new MemoryDatabaseNotificationRepository();
  setNotificationSender(new NotificationSender({ database }));

  class InboxNote extends Notification {
    via(): NotificationChannel[] {
      return ["database"];
    }
    toDatabase() {
      return { body: "hello" };
    }
  }

  const user: Notifiable = { id: 5, notificationType: "User" };
  await notify(user, new InboxNote());

  const inbox = databaseNotifications(user);
  expect(await inbox.get()).toHaveLength(1);
  expect(await inbox.unreadCount()).toBe(1);
  await inbox.markAsRead((await inbox.get())[0]!.id);
  expect(await inbox.unreadCount()).toBe(0);
});

test("Notification.fake records without sending", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);
  setNotificationSender(new NotificationSender());

  const user = { id: 9, email: "ada@example.com", notificationType: "User" };
  const fake = Notification.fake();

  await notify(user, new HelloNotification());
  expect(mailer.messages).toHaveLength(0);

  Notification.assertSentTo(user, HelloNotification);
  Notification.assertSentTimes(HelloNotification, 1);
  Notification.assertCount(1);
  Notification.assertNotSentTo(user, InboxNotification);

  fake.restore();
  await notify(user, new HelloNotification());
  expect(mailer.messages).toHaveLength(1);
});

test("notify slack sms and broadcast channels", async () => {
  const {
    ArraySlackSender,
    ArraySmsSender,
    SlackMessage,
    SmsMessage,
    BroadcastMessage,
  } = await import("../src/index.ts");
  const { SyncBroadcaster, setBroadcaster } = await import(
    "@bunyad/broadcasting"
  );

  const slack = new ArraySlackSender();
  const sms = new ArraySmsSender();
  const broadcaster = new SyncBroadcaster();
  setBroadcaster(broadcaster);
  setNotificationSender(new NotificationSender({ slack, sms }));

  class MultiChannelNote extends Notification {
    via(): NotificationChannel[] {
      return ["slack", "sms", "broadcast"];
    }
    toSlack() {
      return new SlackMessage().text("paid").from("Bunyad");
    }
    toSms() {
      return new SmsMessage().content("Invoice paid").from("BUNYAD");
    }
    toBroadcast() {
      return new BroadcastMessage({ invoice_id: 42 });
    }
  }

  const user: Notifiable = {
    id: 7,
    notificationType: "User",
    phone: "+15551212",
    routeNotificationFor(channel) {
      if (channel === "slack") return "https://hooks.slack.test/T";
      return undefined;
    },
  };

  await notify(user, new MultiChannelNote());

  expect(slack.messages).toHaveLength(1);
  expect(slack.messages[0]!.webhookUrl).toBe("https://hooks.slack.test/T");
  expect(slack.messages[0]!.payload).toMatchObject({
    text: "paid",
    username: "Bunyad",
  });

  expect(sms.messages).toEqual([
    { to: "+15551212", content: "Invoice paid", from: "BUNYAD" },
  ]);

  expect(broadcaster.sent).toHaveLength(1);
  expect(broadcaster.sent[0]).toMatchObject({
    channels: ["User.7"],
    event: "MultiChannelNote",
    payload: { type: "MultiChannelNote", invoice_id: 42 },
  });
});

test("vonage channel uses toVonage and phone route", async () => {
  const { ArraySmsSender, VonageMessage } = await import("../src/index.ts");
  const sms = new ArraySmsSender();
  setNotificationSender(new NotificationSender({ sms }));

  class VonageNote extends Notification {
    via(): NotificationChannel[] {
      return ["vonage"];
    }
    toVonage() {
      return new VonageMessage().content("code 999");
    }
  }

  await notify({ phone: "+10001112222" }, new VonageNote());
  expect(sms.messages[0]).toMatchObject({
    to: "+10001112222",
    content: "code 999",
  });
});

test("MailMessage fluent builds sendable mail", async () => {
  const { MailMessage } = await import("../src/index.ts");
  const mailer = new ArrayMailer();
  setMailer(mailer);
  setNotificationSender(new NotificationSender());

  class InvoicePaid extends Notification {
    toMail() {
      return new MailMessage()
        .greeting("Hello!")
        .line("Invoice paid")
        .lineIf(true, "Amount: 10")
        .action("View", "https://example.com/i/1")
        .success()
        .subject("Paid");
    }
  }

  await Notification.send(
    { email: "ada@example.com" },
    new InvoicePaid(),
  );
  expect(mailer.messages).toHaveLength(1);
  expect(mailer.messages[0]!.subject).toBe("Paid");
  expect(mailer.messages[0]!.html).toContain("Invoice paid");
  expect(mailer.messages[0]!.html).toContain("https://example.com/i/1");
});

test("Notification.route on-demand mail", async () => {
  const { MailMessage } = await import("../src/index.ts");
  const mailer = new ArrayMailer();
  setMailer(mailer);
  setNotificationSender(new NotificationSender());

  class RouteNote extends Notification {
    toMail() {
      return new MailMessage().subject("Hi").line("Routed");
    }
  }

  await Notification.route("mail", "on-demand@example.com").notify(
    new RouteNote(),
  );
  expect(mailer.messages[0]!.to).toBe("on-demand@example.com");
});

test("Notification.sendNow and assertNothingSent", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);
  setNotificationSender(new NotificationSender());
  const fake = Notification.fake();
  await Notification.sendNow({ email: "a@b.c" }, new HelloNotification());
  Notification.assertSentTo({ email: "a@b.c" }, HelloNotification);
  fake.restore();
  Notification.fake();
  Notification.assertNothingSent();
});

test("Notification.assertSentOnDemand for route()", async () => {
  const { MailMessage } = await import("../src/index.ts");
  setMailer(new ArrayMailer());
  setNotificationSender(new NotificationSender());

  class OnDemandNote extends Notification {
    toMail() {
      return new MailMessage().subject("OD").line("on demand");
    }
  }

  Notification.fake();
  await Notification.route("mail", "od@example.com").notify(new OnDemandNote());
  Notification.assertSentOnDemand(OnDemandNote);
  Notification.assertNotSentOnDemand(HelloNotification);
  Notification.assertSentOnDemand(OnDemandNote, (n, notifiable) => {
    return String(notifiable.email) === "od@example.com";
  });
});

test("applyNotifiable mixin and serialized queued notification", async () => {
  const {
    applyNotifiable,
    registerNotification,
    clearNotificationRegistry,
    MemoryDatabaseNotificationRepository,
  } = await import("../src/index.ts");
  const { QueueManager } = await import("@bunyad/queue");

  class User {
    id = 7;
    notificationType = "User";
    email = "mixin@example.com";
  }
  applyNotifiable(User);

  const database = new MemoryDatabaseNotificationRepository();
  const queue = new QueueManager({ connection: "memory" });
  setNotificationSender(new NotificationSender({ database, queue }));

  class SerializedInbox extends Notification {
    shouldQueue = true;
    constructor(readonly body = "ser") {
      super();
    }
    via(): NotificationChannel[] {
      return ["database"];
    }
    toDatabase() {
      return { body: this.body };
    }
  }
  registerNotification(SerializedInbox as never);

  const user = new User() as User & {
    notify: (n: Notification) => Promise<void>;
  };
  await user.notify(new SerializedInbox("queued-body"));
  expect(await database.forNotifiable("User", 7)).toHaveLength(0);
  await queue.work();
  const rows = await database.forNotifiable("User", 7);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.data).toEqual({ body: "queued-body" });
  clearNotificationRegistry();
});
