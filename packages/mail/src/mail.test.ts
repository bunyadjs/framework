import { expect, test } from "bun:test";
import {
  ArrayMailer,
  Mail,
  Mailable,
  formatMime,
  setMailer,
  setMailQueue,
  registerMailable,
  SEND_QUEUED_MAILABLE,
} from "../src/index.ts";

class WelcomeMail extends Mailable {
  constructor(readonly email: string) {
    super();
  }

  envelope() {
    return { to: this.email, subject: "Welcome" };
  }

  content() {
    return { text: `Hello ${this.email}` };
  }
}

test("array mailer collects messages", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);
  await Mail.send(new WelcomeMail("ada@example.com"));
  expect(mailer.messages).toHaveLength(1);
  expect(mailer.messages[0]!.subject).toBe("Welcome");
  expect(mailer.messages[0]!.to).toBe("ada@example.com");
});

test("formatMime builds plain text message", () => {
  const raw = formatMime("from@test", ["to@test"], {
    to: "to@test",
    subject: "Hi",
    text: "Body",
  });
  expect(raw).toContain("Subject: Hi");
  expect(raw).toContain("Body");
  expect(raw).toContain("text/plain");
});

test("formatMime includes attachments", () => {
  const raw = formatMime("from@test", ["to@test"], {
    to: "to@test",
    subject: "Hi",
    text: "Body",
    attachments: [
      {
        filename: "note.txt",
        content: "hello",
        contentType: "text/plain",
      },
    ],
  });
  expect(raw).toContain("multipart/mixed");
  expect(raw).toContain("note.txt");
  expect(raw).toContain("Content-Transfer-Encoding: base64");
});

test("ResendMailer posts to API", async () => {
  const { ResendMailer } = await import("../src/resend-mailer.ts");
  let body: unknown;
  const mailer = new ResendMailer({
    apiKey: "re_test",
    from: "from@test",
    endpoint: "https://example.test/emails",
    fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  await mailer.send({
    to: "ada@example.com",
    subject: "Hi",
    text: "Hello",
  });
  expect(body).toEqual({
    from: "from@test",
    to: ["ada@example.com"],
    subject: "Hi",
    html: undefined,
    text: "Hello",
  });
});

test("PostmarkMailer posts to API", async () => {
  const { PostmarkMailer } = await import("../src/postmark-mailer.ts");
  let body: unknown;
  let headers: Headers | undefined;
  const mailer = new PostmarkMailer({
    apiKey: "pm_test",
    from: "from@test",
    endpoint: "https://example.test/email",
    fetch: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  await mailer.send({
    to: ["ada@example.com", "bob@example.com"],
    subject: "Hi",
    html: "<p>Hello</p>",
    text: "Hello",
  });
  expect(headers?.get("X-Postmark-Server-Token")).toBe("pm_test");
  expect(body).toEqual({
    From: "from@test",
    To: "ada@example.com,bob@example.com",
    Subject: "Hi",
    HtmlBody: "<p>Hello</p>",
    TextBody: "Hello",
  });
});

test("MailgunMailer posts form body", async () => {
  const { MailgunMailer } = await import("../src/mailgun-mailer.ts");
  let url = "";
  let rawBody = "";
  const mailer = new MailgunMailer({
    apiKey: "key-test",
    domain: "mg.example.com",
    from: "from@test",
    endpoint: "https://example.test",
    fetch: (async (reqUrl, init) => {
      url = String(reqUrl);
      rawBody = String(init?.body);
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  await mailer.send({
    to: "ada@example.com",
    subject: "Hi",
    text: "Hello",
  });
  expect(url).toBe("https://example.test/v3/mg.example.com/messages");
  expect(rawBody).toContain("from=from%40test");
  expect(rawBody).toContain("to=ada%40example.com");
  expect(rawBody).toContain("subject=Hi");
});

test("SesMailer signs and posts SendEmail", async () => {
  const { SesMailer } = await import("../src/ses-mailer.ts");
  let url = "";
  let body: unknown;
  let auth = "";
  const mailer = new SesMailer({
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret",
    region: "us-east-1",
    from: "from@test",
    endpoint: "https://email.us-east-1.example.test",
    now: () => new Date("2024-01-15T12:00:00.000Z"),
    fetch: (async (reqUrl, init) => {
      url = String(reqUrl);
      body = JSON.parse(String(init?.body));
      auth = String(new Headers(init?.headers).get("Authorization"));
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  await mailer.send({
    to: "ada@example.com",
    subject: "Hi",
    text: "Hello",
  });
  expect(url).toBe(
    "https://email.us-east-1.example.test/v2/email/outbound-emails",
  );
  expect(auth).toContain("AWS4-HMAC-SHA256 Credential=AKIATEST/");
  expect(auth).toContain("us-east-1/ses/aws4_request");
  expect(body).toEqual({
    FromEmailAddress: "from@test",
    Destination: { ToAddresses: ["ada@example.com"] },
    Content: {
      Simple: {
        Subject: { Data: "Hi" },
        Body: { Text: { Data: "Hello" } },
      },
    },
  });
});

test("markdownToHtml renders basic syntax", async () => {
  const { markdownToHtml } = await import("../src/markdown.ts");
  const html = markdownToHtml("# Hello\n\n**bold** and [x](https://x.test)");
  expect(html).toContain("<h1>Hello</h1>");
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain('<a href="https://x.test">x</a>');
});

test("mailable view and markdown content", async () => {
  const { setMailViewRenderer } = await import("../src/index.ts");
  setMailViewRenderer((name, data) => {
    if (name === "mail.hello") return `<p>Hi ${data.name}</p>`;
    if (name === "mail.md") return `# Hi ${data.name}`;
    return "";
  });

  class ViewMail extends Mailable {
    envelope() {
      return { to: "a@b.c", subject: "V" };
    }
    content() {
      return { view: "mail.hello", with: { name: "Ada" } };
    }
  }
  expect((await new ViewMail().toMessage()).html).toBe("<p>Hi Ada</p>");

  class MdMail extends Mailable {
    envelope() {
      return { to: "a@b.c", subject: "M" };
    }
    content() {
      return { markdown: "mail.md", with: { name: "Ada" } };
    }
  }
  expect((await new MdMail().toMessage()).html).toContain("<h1>Hi Ada</h1>");
});

test("attachData and embedData", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);

  class FileMail extends Mailable {
    envelope() {
      return { to: "a@b.c", subject: "F" };
    }
    content() {
      const cid = this.embedData("<svg></svg>", "logo.svg", {
        mime: "image/svg+xml",
      });
      this.attachData("hello", "note.txt", { mime: "text/plain" });
      return { html: `<img src="${cid}" />` };
    }
  }

  await Mail.send(new FileMail());
  const msg = mailer.messages[0]!;
  expect(msg.attachments).toHaveLength(2);
  expect(msg.attachments![0]!.cid).toBeTruthy();
  expect(msg.attachments![1]!.filename).toBe("note.txt");
  expect(msg.html).toContain("cid:");
});

test("shouldQueue defers send until queue works", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);

  const jobs: Array<{ name: string; data: unknown; queue?: string }> = [];
  const handlers = new Map<
    string,
    (data: unknown) => void | Promise<void>
  >();

  setMailQueue({
    push(name, data, queue) {
      jobs.push({ name, data, queue });
      return Promise.resolve(crypto.randomUUID());
    },
    register(name, handler) {
      handlers.set(name, handler);
      return this;
    },
  });

  class QueuedWelcome extends Mailable {
    shouldQueue = true;
    constructor(readonly email: string) {
      super();
    }
    envelope() {
      return { to: this.email, subject: "Queued" };
    }
    content() {
      return { text: "later" };
    }
  }

  await Mail.send(new QueuedWelcome("queued@example.com"));
  expect(mailer.messages).toHaveLength(0);
  expect(jobs).toHaveLength(1);
  expect(jobs[0]!.name).toBe(SEND_QUEUED_MAILABLE);

  await handlers.get(SEND_QUEUED_MAILABLE)!(jobs[0]!.data);
  expect(mailer.messages).toHaveLength(1);
  expect(mailer.messages[0]!.subject).toBe("Queued");
  expect((jobs[0]!.data as { kind: string }).kind).toBe("message");
});

test("shouldQueue serializes registered mailable class", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);

  const jobs: Array<{ name: string; data: unknown }> = [];
  const handlers = new Map<
    string,
    (data: unknown) => void | Promise<void>
  >();

  setMailQueue({
    push(name, data) {
      jobs.push({ name, data });
      return Promise.resolve(crypto.randomUUID());
    },
    register(name, handler) {
      handlers.set(name, handler);
      return this;
    },
  });

  class ClassWelcome extends Mailable {
    shouldQueue = true;
    constructor(readonly email: string) {
      super();
    }
    envelope() {
      return { to: this.email, subject: `Hi ${this.email}` };
    }
    content() {
      return { text: `body for ${this.email}` };
    }
  }

  registerMailable(ClassWelcome);

  const mailable = new ClassWelcome("ada@example.com");
  mailable.attachData("note", "note.txt");
  await Mail.send(mailable);

  expect(mailer.messages).toHaveLength(0);
  const payload = jobs[0]!.data as {
    kind: string;
    name: string;
    props: { email: string };
    pending: unknown[];
  };
  expect(payload.kind).toBe("mailable");
  expect(payload.name).toBe("ClassWelcome");
  expect(payload.props.email).toBe("ada@example.com");
  expect(payload.pending).toHaveLength(1);

  await handlers.get(SEND_QUEUED_MAILABLE)!(payload);
  expect(mailer.messages).toHaveLength(1);
  expect(mailer.messages[0]!.subject).toBe("Hi ada@example.com");
  expect(mailer.messages[0]!.attachments?.[0]?.filename).toBe("note.txt");
});

test("Mail.fake asserts sent messages", async () => {
  setMailer(new ArrayMailer());
  Mail.fake();

  await Mail.send(new WelcomeMail("ada@example.com"));

  Mail.assertSent((m) => m.to === "ada@example.com" && m.subject === "Welcome");
  Mail.assertSent(WelcomeMail);
  Mail.assertSentCount(1);
  Mail.assertNotSent((m) => m.subject === "Other");
  Mail.restore();
});

test("Mail.to/cc fluent + alwaysFrom + raw/html", async () => {
  Mail.alwaysFrom(null);
  Mail.alwaysTo(null);
  Mail.alwaysReplyTo(null);

  const mailer = new ArrayMailer();
  setMailer(mailer);
  Mail.alwaysFrom("noreply@app.test");

  await Mail.to("ada@example.com")
    .cc("cc@example.com")
    .send(
      new (class extends Mailable {
        envelope() {
          return { to: "ignored@example.com", subject: "Order" };
        }
        content() {
          return { html: "<p>Thanks</p>", text: "Thanks" };
        }
      })(),
    );

  expect(mailer.messages[0]!.to).toBe("ada@example.com");
  expect(mailer.messages[0]!.cc).toBe("cc@example.com");
  expect(mailer.messages[0]!.from).toBe("noreply@app.test");

  await Mail.raw("plain", "raw@example.com", "Raw");
  await Mail.html("<b>hi</b>", "html@example.com", "Html");
  expect(mailer.messages).toHaveLength(3);
  expect(mailer.messages[1]!.text).toBe("plain");
  expect(mailer.messages[2]!.html).toBe("<b>hi</b>");

  Mail.alwaysFrom(null);
});

test("mailable asserts and render", async () => {
  class InvoiceMail extends Mailable {
    envelope() {
      return {
        to: "ada@example.com",
        subject: "Invoice Paid",
        from: "billing@example.com",
        cc: "cc@example.com",
        replyTo: "support@example.com",
      };
    }
    content() {
      this.attachData("pdf", "invoice.pdf");
      return { html: "<p>Invoice Paid</p><p>Thanks</p>", text: "Invoice Paid\nThanks" };
    }
  }

  const mail = new InvoiceMail();
  await mail.assertHasSubject("Invoice Paid");
  await mail.assertTo("ada@example.com");
  await mail.assertFrom("billing@example.com");
  await mail.assertHasCc("cc@example.com");
  await mail.assertHasReplyTo("support@example.com");
  await mail.assertSeeInHtml("Invoice Paid");
  await mail.assertSeeInOrderInHtml(["Invoice Paid", "Thanks"]);
  await mail.assertSeeInText("Thanks");
  await mail.assertHasAttachedData("pdf", "invoice.pdf");
  expect(await mail.render()).toContain("Invoice Paid");
});

test("Mail.fake assertQueued", async () => {
  setMailer(new ArrayMailer());
  Mail.fake();

  class QueuedMail extends Mailable {
    shouldQueue = true;
    envelope() {
      return { to: "q@example.com", subject: "Q" };
    }
    content() {
      return { text: "later" };
    }
  }

  await Mail.queue(new QueuedMail());
  Mail.assertQueued(QueuedMail);
  Mail.assertQueuedCount(1);
  Mail.assertNothingSent();
  Mail.restore();
});

test("formatMime includes cc and reply-to", () => {
  const raw = formatMime("from@test", ["to@test"], {
    to: "to@test",
    subject: "Hi",
    text: "Body",
    cc: "cc@test",
    replyTo: "reply@test",
  });
  expect(raw).toContain("Cc: cc@test");
  expect(raw).toContain("Reply-To: reply@test");
});

test("Mail.later queues with delay on payload", async () => {
  const mailer = new ArrayMailer();
  setMailer(mailer);

  const jobs: Array<{ name: string; data: unknown; queue?: string }> = [];
  setMailQueue({
    push(name, data, queue) {
      jobs.push({ name, data, queue });
      return Promise.resolve(crypto.randomUUID());
    },
    register() {
      return this;
    },
  });

  class LaterMail extends Mailable {
    envelope() {
      return { to: "later@example.com", subject: "Later" };
    }
    content() {
      return { text: "delayed" };
    }
  }

  await Mail.later(90, new LaterMail());
  expect(mailer.messages).toHaveLength(0);
  expect(jobs).toHaveLength(1);
  expect((jobs[0]!.data as { delay?: number }).delay).toBe(90);

  Mail.fake();
  const queued = new LaterMail();
  await Mail.laterOn("emails", 30, queued);
  expect(queued.delay).toBe(30);
  expect(queued.queueName).toBe("emails");
  Mail.assertQueued(LaterMail);
  Mail.assertQueuedCount(1);
  Mail.restore();
});

test("LogMailer send does not throw", async () => {
  const { LogMailer } = await import("../src/log-mailer.ts");
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await new LogMailer().send({
      to: "ada@example.com",
      subject: "Log me",
      text: "hi",
    });
  } finally {
    console.log = original;
  }
  expect(logs.some((l) => l.includes("ada@example.com") && l.includes("Log me"))).toBe(
    true,
  );
});

test("Mail.mailer named driver via extend", async () => {
  const primary = new ArrayMailer();
  const smtpLike = new ArrayMailer();
  setMailer(primary);
  Mail.extend("smtp", smtpLike);

  await Mail.mailer("smtp")
    .to("named@example.com")
    .send(new WelcomeMail("ignored@example.com"));

  expect(primary.messages).toHaveLength(0);
  expect(smtpLike.messages).toHaveLength(1);
  expect(smtpLike.messages[0]!.to).toBe("named@example.com");
});

test("FailoverMailer and RoundRobinMailer", async () => {
  const { FailoverMailer, RoundRobinMailer } = await import("../src/index.ts");
  const failing: { send: (m: unknown) => Promise<void> } = {
    async send() {
      throw new Error("down");
    },
  };
  const ok = new ArrayMailer();
  const failover = new FailoverMailer([failing as never, ok]);
  await failover.send({ to: "a@b.c", subject: "x", text: "y" });
  expect(ok.messages).toHaveLength(1);

  const a = new ArrayMailer();
  const b = new ArrayMailer();
  const rr = new RoundRobinMailer([a, b]);
  await rr.send({ to: "1@x", subject: "1", text: "1" });
  await rr.send({ to: "2@x", subject: "2", text: "2" });
  expect(a.messages.length + b.messages.length).toBe(2);
  expect(a.messages.length).toBe(1);
  expect(b.messages.length).toBe(1);
});

test("renderNotificationMailHtml builds Laravel-style card", async () => {
  const { renderNotificationMailHtml, setMailMarkdownDefaults } = await import(
    "../src/theme.ts"
  );
  setMailMarkdownDefaults({ appName: "Karobar Point" });
  const html = renderNotificationMailHtml({
    greeting: "Hello!",
    introLines: ["Please click the button below to verify your email address."],
    actionText: "Verify Email Address",
    actionUrl: "https://example.com/verify?token=abc",
    outroLines: ["If you did not create an account, no further action is required."],
    logoUrl: "https://example.com/logo.svg",
  });
  expect(html).toContain("class=\"wrapper\"");
  expect(html).toContain("class=\"inner-body\"");
  expect(html).toContain("<h1>Hello!</h1>");
  expect(html).toContain("Please click the button below");
  expect(html).toContain("class=\"button button-primary\"");
  expect(html).toContain("Verify Email Address");
  expect(html).toContain("https://example.com/verify?token=abc");
  expect(html).toContain("class=\"subcopy\"");
  expect(html).toContain("copy and paste the URL below");
  expect(html).toContain("Karobar Point");
  expect(html).toContain("All rights reserved");
  expect(html).toContain("https://example.com/logo.svg");
  expect(html).toContain("Regards");
});

test("renderMarkdownMail wraps body and renders x-mail::button", async () => {
  const { renderMarkdownMail } = await import("../src/theme.ts");
  const { html } = renderMarkdownMail(
    `<x-mail::message>
# Hello!

Please click the button below to verify your email address.

<x-mail::button url="https://example.com/verify">
Verify Email Address
</x-mail::button>

If you did not create an account, no further action is required.
</x-mail::message>`,
    { appName: "Karobar Point" },
  );
  expect(html).toContain("<h1>Hello!</h1>");
  expect(html).toContain("class=\"button button-primary\"");
  expect(html).toContain("https://example.com/verify");
  expect(html).toContain("class=\"subcopy\"");
  expect(html).toContain("Karobar Point");
});

test("mailable markdown content uses themed layout", async () => {
  const { setMailMarkdownDefaults } = await import("../src/theme.ts");
  setMailMarkdownDefaults({ appName: "Theme App" });

  class ThemedMdMail extends Mailable {
    envelope() {
      return { to: "a@b.c", subject: "Verify" };
    }
    content() {
      return {
        markdown: [
          "# Hello!",
          "",
          "Please verify.",
          "",
          '<x-mail::button url="https://example.com/v">Verify Email Address</x-mail::button>',
        ].join("\n"),
      };
    }
  }

  const msg = await new ThemedMdMail().toMessage();
  expect(msg.html).toContain("class=\"inner-body\"");
  expect(msg.html).toContain("Verify Email Address");
  expect(msg.html).toContain("Theme App");
});


test("renderMarkdownMail does not double-wrap already themed HTML", async () => {
  const { renderMarkdownMail, renderNotificationMailHtml } = await import(
    "../src/theme.ts"
  );
  const themed = renderNotificationMailHtml({
    greeting: "Hello!",
    introLines: ["Once only."],
    actionText: "Go",
    actionUrl: "https://example.com",
    appName: "App",
  });
  const { html } = renderMarkdownMail(themed, { appName: "App" });
  expect(html).toBe(themed);
  expect(html.split('class="wrapper"').length - 1).toBe(1);
  expect(html.split('class="inner-body"').length - 1).toBe(1);
  expect(html.split('<h1>Hello!</h1>').length - 1).toBe(1);
});
