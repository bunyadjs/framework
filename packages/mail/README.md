# @bunyad/mail

Mailables, a fluent `Mail` facade and pluggable mailers (SMTP, Resend, Postmark, Mailgun, SES, log, array) with failover, round-robin, markdown templates and test fakes.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/mail@beta
# or: npm install @bunyad/mail@beta
```

## Usage

```ts
import { ArrayMailer, Mail, Mailable, setMailer } from "@bunyad/mail";

class WelcomeMail extends Mailable {
  constructor(readonly email: string) { super(); }
  envelope() { return { to: this.email, subject: "Welcome" }; }
  content() { return { text: `Hello ${this.email}` }; }
}

// ArrayMailer keeps messages in memory; swap in SmtpMailer, ResendMailer, ... in production.
const mailer = new ArrayMailer();
setMailer(mailer);

await Mail.send(new WelcomeMail("ada@example.com"));
console.log(mailer.messages.length, mailer.messages[0]!.subject); // 1 "Welcome"

// Fluent recipients
await Mail.to("bob@example.com").send(new WelcomeMail("bob@example.com"));
console.log(mailer.messages.length); // 2

// In tests, record and assert
Mail.fake();
await Mail.send(new WelcomeMail("cy@example.com"));
Mail.assertSent(WelcomeMail);
Mail.assertSentCount(1);
Mail.restore();
```

## Notes

- Runs on Bun only (1.4 or newer). Mailers use `fetch` or Bun sockets, with no extra peer dependencies.
- `SmtpMailer` takes `{ host, port?, from, username?, password?, tls? }`; the HTTP mailers take `{ apiKey, from, ... }` (see each `*MailerOptions` type).
- Combine mailers with `FailoverMailer` or `RoundRobinMailer`, and register named ones with `registerMailer` / `Mail.mailer(name)`.
- Mailables that implement `ShouldQueue` are sent through a queue set with `setMailQueue` (for example one backed by `@bunyad/queue`).
- Content can be `text`, `html`, a view, or `markdown` (rendered in a themed layout).

## License

MIT
