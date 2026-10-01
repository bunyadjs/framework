import type { Mailer, MailMessage } from "@bunyad/contracts";

export type SmtpMailerOptions = {
  host: string;
  port?: number;
  /** MAIL FROM / envelope sender. */
  from: string;
  username?: string;
  password?: string;
  /** Use implicit TLS (typically port 465). */
  tls?: boolean;
};

/**
 * Minimal SMTP mailer over Bun TCP sockets.
 * Suitable for Mailpit / Mailhog / local relays.
 */
export class SmtpMailer implements Mailer {
  readonly #options: Required<
    Pick<SmtpMailerOptions, "host" | "port" | "from" | "tls">
  > &
    Pick<SmtpMailerOptions, "username" | "password">;

  constructor(options: SmtpMailerOptions) {
    this.#options = {
      host: options.host,
      port: options.port ?? 587,
      from: options.from,
      username: options.username,
      password: options.password,
      tls: options.tls ?? false,
    };
  }

  async send(message: MailMessage): Promise<void> {
    const recipients = [
      ...asList(message.to),
      ...asList(message.cc),
      ...asList(message.bcc),
    ];
    const session = await openSmtpSession({
      hostname: this.#options.host,
      port: this.#options.port,
      tls: this.#options.tls,
    });

    try {
      await session.expect(220);
      await session.command("EHLO localhost");
      await session.readMultiline();

      if (this.#options.username && this.#options.password) {
        await session.command("AUTH LOGIN");
        await session.expect(334);
        await session.command(btoa(this.#options.username));
        await session.expect(334);
        await session.command(btoa(this.#options.password));
        await session.expect(235);
      }

      const envelopeFrom = message.from ?? this.#options.from;
      await session.command(`MAIL FROM:<${envelopeFrom}>`);
      await session.expect(250);

      for (const to of recipients) {
        await session.command(`RCPT TO:<${to}>`);
        await session.expect(250);
      }

      await session.command("DATA");
      await session.expect(354);

      const body = formatMime(
        this.#options.from,
        asList(message.to),
        message,
      );
      session.write(`${body}\r\n.\r\n`);
      await session.expect(250);

      await session.command("QUIT");
    } finally {
      session.close();
    }
  }
}

function asList(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function formatMime(
  from: string,
  to: string[],
  message: MailMessage,
): string {
  const attachments = message.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  const sender = message.from ?? from;
  const cc = asList(message.cc);
  const bcc = asList(message.bcc);
  const replyTo = asList(message.replyTo);

  const headers = [`From: ${sender}`, `To: ${to.join(", ")}`];
  if (cc.length) headers.push(`Cc: ${cc.join(", ")}`);
  if (bcc.length) headers.push(`Bcc: ${bcc.join(", ")}`);
  headers.push(`Subject: ${message.subject}`, "MIME-Version: 1.0");
  if (replyTo.length) headers.push(`Reply-To: ${replyTo.join(", ")}`);

  const bodyPart = (() => {
    if (message.html && message.text) {
      const alt = `mime-alt-${crypto.randomUUID()}`;
      return [
        `Content-Type: multipart/alternative; boundary="${alt}"`,
        "",
        `--${alt}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        message.text,
        `--${alt}`,
        "Content-Type: text/html; charset=utf-8",
        "",
        message.html,
        `--${alt}--`,
      ].join("\r\n");
    }
    if (message.html) {
      return ["Content-Type: text/html; charset=utf-8", "", message.html].join(
        "\r\n",
      );
    }
    return [
      "Content-Type: text/plain; charset=utf-8",
      "",
      message.text ?? "",
    ].join("\r\n");
  })();

  if (!hasAttachments) {
    return [...headers, bodyPart].join("\r\n").replaceAll(/^\./gm, "..");
  }

  const mixed = `mime-mixed-${crypto.randomUUID()}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    bodyPart,
  ];

  for (const file of attachments) {
    const bytes =
      typeof file.content === "string"
        ? new TextEncoder().encode(file.content)
        : file.content;
    const b64 = Buffer.from(bytes).toString("base64");
    const wrapped = b64.replace(/(.{76})/g, "$1\r\n").trim();
    const disposition = file.cid
      ? `inline; filename="${file.filename}"`
      : `attachment; filename="${file.filename}"`;
    parts.push(
      `--${mixed}`,
      `Content-Type: ${file.contentType ?? "application/octet-stream"}; name="${file.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: ${disposition}`,
      ...(file.cid ? [`Content-ID: <${file.cid}>`] : []),
      "",
      wrapped,
    );
  }
  parts.push(`--${mixed}--`);
  return parts.join("\r\n").replaceAll(/^\./gm, "..");
}

type SmtpSession = {
  expect(code: number): Promise<string>;
  command(line: string): Promise<void>;
  readMultiline(): Promise<void>;
  write(data: string): void;
  close(): void;
};

async function openSmtpSession(opts: {
  hostname: string;
  port: number;
  tls: boolean;
}): Promise<SmtpSession> {
  let buffer = "";
  const queue: string[] = [];
  let pending: ((line: string) => void) | undefined;

  const pushLines = (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, "");
      buffer = buffer.slice(idx + 1);
      if (pending) {
        const resolve = pending;
        pending = undefined;
        resolve(line);
      } else {
        queue.push(line);
      }
    }
  };

  const readLine = () =>
    new Promise<string>((resolve) => {
      if (queue.length > 0) {
        resolve(queue.shift()!);
        return;
      }
      pending = resolve;
    });

  const socket = await Bun.connect({
    hostname: opts.hostname,
    port: opts.port,
    tls: opts.tls || undefined,
    socket: {
      data(_socket, data) {
        pushLines(typeof data === "string" ? data : new TextDecoder().decode(data));
      },
      open() {},
      close() {},
      error(_socket, error) {
        if (pending) {
          pending = undefined;
        }
        throw error;
      },
    },
  });

  return {
    async expect(code) {
      const line = await readLine();
      if (!line.startsWith(String(code))) {
        throw new Error(`SMTP expected ${code}, got: ${line}`);
      }
      return line;
    },
    async command(line) {
      socket.write(`${line}\r\n`);
    },
    async readMultiline() {
      for (;;) {
        const line = await readLine();
        if (/^\d{3} /.test(line)) return;
      }
    },
    write(data) {
      socket.write(data);
    },
    close() {
      socket.end();
    },
  };
}
