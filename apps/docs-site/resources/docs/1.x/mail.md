---
title: Mail
description: Build mailables, send through SMTP or API drivers, queue delivery, and assert outbound mail in tests.
---

# Mail

## Introduction

Mailables are classes that describe one email: who receives it, the subject, and the body. You send them with the `Mail` facade. Framework apps boot a mailer from `config/mail.ts`. Standalone apps call `setMailer` with a driver from `@bunyad/mail`.

```ts
import { Mail } from "@bunyad/mail";
import WelcomeMail from "@/Mail/WelcomeMail.ts";

await Mail.send(new WelcomeMail("ada@example.com"));
```

## Configuration

Framework apps read `config/mail.ts`. The default mailer is `MAIL_MAILER`, or `array` when that variable is unset:

```ts
export default {
  default: process.env.MAIL_MAILER ?? "array",
  from: {
    address:
      process.env.MAIL_FROM_ADDRESS ??
      process.env.MAIL_FROM ??
      "noreply@bunyad.test",
    name: process.env.MAIL_FROM_NAME ?? "Bunyad",
  },
  mailers: {
    array: { transport: "array" },
    log: { transport: "log" },
    smtp: {
      transport: "smtp",
      host: process.env.MAIL_HOST ?? "127.0.0.1",
      port: Number(process.env.MAIL_PORT ?? 1025),
      username: process.env.MAIL_USERNAME,
      password: process.env.MAIL_PASSWORD,
      tls: process.env.MAIL_TLS === "true",
    },
    resend: {
      transport: "resend",
      key: process.env.RESEND_API_KEY,
    },
    postmark: {
      transport: "postmark",
      token: process.env.POSTMARK_API_KEY ?? process.env.MAIL_PASSWORD,
    },
    mailgun: {
      transport: "mailgun",
      secret: process.env.MAILGUN_SECRET ?? process.env.MAIL_PASSWORD,
      domain: process.env.MAILGUN_DOMAIN,
      endpoint: process.env.MAILGUN_ENDPOINT,
    },
    ses: {
      transport: "ses",
      key: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    },
  },
};
```

`MailServiceProvider` builds the mailer for `default` and calls `setMailer`. It also registers classes under `app/Mail` so queued jobs can revive them by name. `ViewServiceProvider` wires the view engine so `view` and `markdown` content can render templates. `QueueServiceProvider` calls `setMailQueue` when a queue manager is available.

| Transport | Role |
| --- | --- |
| `array` | Keep messages in memory. Default for local work and tests. |
| `log` | Write the message to the console. |
| `smtp` | Send over SMTP (Mailpit, Mailhog, or a real relay). |
| `resend` | HTTP API via Resend. |
| `postmark` | HTTP API via Postmark. |
| `mailgun` | HTTP API via Mailgun. |
| `ses` | Amazon SES `SendEmail` API. |

A minimal app that does not load the framework provider sets a mailer itself:

```ts
import { ArrayMailer, setMailer } from "@bunyad/mail";

setMailer(new ArrayMailer());
```

### Global address defaults

Apply a from, reply-to, or return-path address to every message that does not already set one. `alwaysTo` replaces the recipient list (useful in staging):

```ts
import { Mail } from "@bunyad/mail";

Mail.alwaysFrom("noreply@example.com");
Mail.alwaysReplyTo("support@example.com");
Mail.alwaysTo("catch-all@example.com");
Mail.alwaysReturnPath("bounces@example.com");
```

Pass `null` to clear a default.

### Named mailers

`Mail.mailer("smtp")` and `mailable.mailer("smtp")` resolve a mailer registered with `Mail.extend` (or `registerMailer`). The service provider installs only the default transport. Register extra drivers at boot when you need more than one:

```ts
import { Mail, SmtpMailer } from "@bunyad/mail";

Mail.extend(
  "smtp",
  new SmtpMailer({
    host: process.env.MAIL_HOST ?? "127.0.0.1",
    port: Number(process.env.MAIL_PORT ?? 1025),
    from: process.env.MAIL_FROM_ADDRESS ?? "noreply@bunyad.test",
  }),
);

await Mail.mailer("smtp").to("ada@example.com").send(new WelcomeMail("ada@example.com"));
```

## Generating mailables

`make:mailable` writes a class under `app/Mail`:

```shell
bunyad make:mailable Welcome
```

That creates `app/Mail/WelcomeMail.ts` with `envelope` and `content` stubs. You can also create the file by hand.

## Writing mailables

Extend `Mailable` and implement `envelope` and `content`:

```ts
import { Mailable } from "@bunyad/mail";

export default class WelcomeMail extends Mailable {
  constructor(readonly email: string) {
    super();
  }

  envelope() {
    return {
      to: this.email,
      subject: "Welcome to Bunyad",
      from: "hello@example.com",
      cc: "ops@example.com",
      replyTo: "support@example.com",
    };
  }

  content() {
    return {
      markdown: "mail.welcome",
      with: { email: this.email },
    };
  }
}
```

`envelope` returns recipients and subject. Optional fields: `from`, `cc`, `bcc`, `replyTo`. Addresses may be a string, an array of strings, or `{ email, name? }` objects (the name is not written into the address field today; the email is).

`content` returns the body. Use one of:

| Field | Behavior |
| --- | --- |
| `html` | Raw HTML string. |
| `text` | Plain text string. |
| `view` | View name rendered through the mail view renderer. |
| `markdown` | View name or inline markdown, converted to HTML. |
| `with` | Data bag for `view` / `markdown`. |

### Views and markdown

With the framework view engine wired, a markdown view under `resources/views/mail/welcome.view` can look like:

```md
# Thanks for joining

Welcome, **{{ email }}**.

- Build with Bun
- Ship Bunyad APIs
```

Inline markdown works without a view when you pass a multi-line string as `markdown`. Headings, emphasis, links, lists, and paragraphs are converted to HTML.

Fluent overrides on the instance also set content:

```ts
mailable
  .view("mail.invoice", { total: 42 })
  .markdown("mail.invoice-md", { total: 42 })
  .html("<p>Paid</p>")
  .text("Paid")
  .with("currency", "USD");
```

### Recipients and metadata on the instance

Chain recipient and metadata helpers after construction. They override `envelope` / `content` when present:

```ts
await Mail.send(
  new WelcomeMail("ignored@example.com")
    .to("ada@example.com")
    .cc("cc@example.com")
    .bcc("bcc@example.com")
    .from("billing@example.com")
    .replyTo("support@example.com")
    .subject("Your account is ready")
    .mailer("smtp")
    .tag("onboarding")
    .metadata("user_id", "42")
    .priority(1),
);
```

`when`, `unless`, and `tap` run callbacks conditionally. `locale` / `withLocale` store a preferred locale on the instance for your own rendering logic.

### Attachments

Attach files from disk, raw bytes, or mail storage:

```ts
mailable.attach("/tmp/invoice.pdf", { as: "invoice.pdf", mime: "application/pdf" });
mailable.attachMany(["/tmp/a.pdf", { path: "/tmp/b.pdf", as: "b.pdf" }]);
mailable.attachData("hello", "note.txt", { mime: "text/plain" });

await mailable.attachFromStorage("invoices/42.pdf");
await mailable.attachFromStorageDisk("s3", "invoices/42.pdf", "invoice.pdf");
```

`attachFromStorage` / `attachFromStorageDisk` require `setMailStorage` with an object that implements `get(path)` (and optionally `disk(name)`).

Embed images for HTML with a content id:

```ts
content() {
  const cid = this.embedData("<svg></svg>", "logo.svg", {
    mime: "image/svg+xml",
  });
  return { html: `<img src="${cid}" alt="Logo" />` };
}
```

`embed(path)` reads a file from disk the same way.

## Sending mail

```ts
import { Mail } from "@bunyad/mail";
import WelcomeMail from "@/Mail/WelcomeMail.ts";

await Mail.send(new WelcomeMail("ada@example.com"));
await Mail.sendNow(new WelcomeMail("ada@example.com")); // force sync even if shouldQueue
await Mail.queue(new WelcomeMail("ada@example.com"));
await Mail.queueOn("emails", new WelcomeMail("ada@example.com"));
await Mail.later(60, new WelcomeMail("ada@example.com"));
await Mail.laterOn("emails", 60, new WelcomeMail("ada@example.com"));
```

Fluent recipients wrap a `PendingMail` builder:

```ts
await Mail.to("ada@example.com")
  .cc("cc@example.com")
  .bcc("audit@example.com")
  .locale("en")
  .send(new WelcomeMail("ignored@example.com"));

await Mail.to("ada@example.com").queue(new WelcomeMail("ada@example.com"));
await Mail.to("ada@example.com").later(30, new WelcomeMail("ada@example.com"));
```

Send plain text or HTML without a mailable:

```ts
await Mail.raw("Account created.", "ada@example.com", "Welcome");
await Mail.plain("Account created.", "ada@example.com", "Welcome");
await Mail.html("<p>Account created.</p>", "ada@example.com", "Welcome");
```

Render HTML (or text fallback) without sending:

```ts
const html = await Mail.render(new WelcomeMail("ada@example.com"));
// or
const html = await new WelcomeMail("ada@example.com").render();
```

### Queueing mailables

Set `shouldQueue = true` on the class, or call `Mail.queue` / `mailable.queue()`. A queue must be configured (`setMailQueue` / `Mail.setQueue`, which the framework does from `QueueServiceProvider`):

```ts
export default class WelcomeMail extends Mailable {
  shouldQueue = true;
  queue = "emails";

  // ...
}
```

```ts
await new WelcomeMail("ada@example.com").queue();
await new WelcomeMail("ada@example.com").queueOn("emails");
await new WelcomeMail("ada@example.com").later(60);
await new WelcomeMail("ada@example.com").laterOn("emails", 60);
```

Queued jobs use the handler name `SendQueuedMailable`. If the class was discovered under `app/Mail` (or you called `registerMailable`), the job stores the class name, constructor props, and pending attachments, then hydrates a fresh instance on the worker. Otherwise the rendered message is serialized as a plain payload.

## Testing

### Faking the mailer

`Mail.fake()` swaps in a `MailFake` that records sent and queued mailables instead of delivering them:

```ts
import { Mail } from "@bunyad/mail";
import WelcomeMail from "@/Mail/WelcomeMail.ts";

Mail.fake();

await Mail.send(new WelcomeMail("ada@example.com"));

Mail.assertSent(WelcomeMail);
Mail.assertSent((message) => String(message.to).includes("ada@example.com"));
Mail.assertSent(WelcomeMail, (mailable) => mailable.hasTo("ada@example.com"));
Mail.assertSent(WelcomeMail, 1);
Mail.assertSentCount(1);
Mail.assertNotSent((message) => message.subject === "Other");
Mail.assertNothingSent();

Mail.restore();
```

Queued assertions:

```ts
await Mail.queue(new WelcomeMail("ada@example.com"));

Mail.assertQueued(WelcomeMail);
Mail.assertQueuedCount(1);
Mail.assertNotQueued(OtherMail);
Mail.assertNothingQueued();
```

### Asserting a mailable in isolation

Build a mailable and assert on the rendered message without sending:

```ts
const mail = new WelcomeMail("ada@example.com");

await mail.assertHasSubject("Welcome to Bunyad");
await mail.assertTo("ada@example.com");
await mail.assertFrom("hello@example.com");
await mail.assertHasCc("ops@example.com");
await mail.assertSeeInHtml("Welcome");
await mail.assertSeeInOrderInHtml(["Thanks", "Welcome"]);
await mail.assertSeeInText("Welcome");
await mail.assertHasAttachment("invoice.pdf");
await mail.assertHasAttachedData("hello", "note.txt");
await mail.assertHasNoAttachments();
```

Helpers such as `hasTo`, `hasSubject`, `hasTag`, and `hasAttachment` return booleans when you prefer `expect` over thrown assertions.

## Local development

Keep `MAIL_MAILER=array` or `log` while iterating. Point `smtp` at Mailpit or Mailhog (`MAIL_HOST=127.0.0.1`, `MAIL_PORT=1025`) when you want a real inbox UI. Use `Mail.alwaysTo("you@example.com")` in non-production environments so every message lands in one mailbox.
