import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { MailAttachment, MailMessage as RawMailMessage } from "@bunyad/contracts";
import { renderNotificationMailHtml } from "@bunyad/mail";
import type { Notifiable } from "../notification.ts";

type AddressInput = string | { name?: string; address: string };

/**
 * Fluent notification mail builder (`toMail()` return value).
 */
export class MailMessage {
  #level = "info";
  #subject?: string;
  #greeting?: string;
  #salutation?: string;
  #introLines: string[] = [];
  #outroLines: string[] = [];
  #actionText?: string;
  #actionUrl?: string;
  #mailer?: string;
  #markdown?: string;
  #theme?: string;
  #view?: string | string[];
  #viewData: Record<string, unknown> = {};
  #from?: AddressInput;
  #replyTo: AddressInput[] = [];
  #cc: AddressInput[] = [];
  #bcc: AddressInput[] = [];
  #attachments: Array<{ path: string; as?: string; mime?: string }> = [];
  #rawAttachments: MailAttachment[] = [];
  #tags: string[] = [];
  #metadata: Record<string, string> = {};
  #priority?: number;
  #to?: string | string[];

  subject(subject: string): this {
    this.#subject = subject;
    return this;
  }

  greeting(greeting: string): this {
    this.#greeting = greeting;
    return this;
  }

  salutation(salutation: string): this {
    this.#salutation = salutation;
    return this;
  }

  line(line: string): this {
    if (this.#actionText) this.#outroLines.push(line);
    else this.#introLines.push(line);
    return this;
  }

  lines(lines: Iterable<string>): this {
    for (const line of lines) this.line(line);
    return this;
  }

  lineIf(condition: boolean, line: string): this {
    if (condition) this.line(line);
    return this;
  }

  linesIf(condition: boolean, lines: Iterable<string>): this {
    if (condition) this.lines(lines);
    return this;
  }

  action(text: string, url: string): this {
    this.#actionText = text;
    this.#actionUrl = url;
    return this;
  }

  success(): this {
    return this.level("success");
  }

  error(): this {
    return this.level("error");
  }

  level(level: string): this {
    this.#level = level;
    return this;
  }

  mailer(mailer: string): this {
    this.#mailer = mailer;
    return this;
  }

  markdown(view: string, data: Record<string, unknown> = {}): this {
    this.#markdown = view;
    Object.assign(this.#viewData, data);
    return this;
  }

  view(view: string | string[], data: Record<string, unknown> = {}): this {
    this.#view = view;
    Object.assign(this.#viewData, data);
    return this;
  }

  template(template: string): this {
    return this.markdown(template);
  }

  theme(theme: string): this {
    this.#theme = theme;
    return this;
  }

  metadata(key: string, value: string): this {
    this.#metadata[key] = value;
    return this;
  }

  tag(tag: string): this {
    this.#tags.push(tag);
    return this;
  }

  priority(level: number): this {
    this.#priority = level;
    return this;
  }

  from(address: AddressInput, name?: string): this {
    this.#from =
      typeof address === "string" && name
        ? { address, name }
        : address;
    return this;
  }

  replyTo(address: AddressInput | AddressInput[], name?: string): this {
    this.#pushAddresses(this.#replyTo, address, name);
    return this;
  }

  cc(address: AddressInput | AddressInput[], name?: string): this {
    this.#pushAddresses(this.#cc, address, name);
    return this;
  }

  bcc(address: AddressInput | AddressInput[], name?: string): this {
    this.#pushAddresses(this.#bcc, address, name);
    return this;
  }

  /** Set explicit recipients (otherwise routed from the notifiable). */
  to(address: string | string[]): this {
    this.#to = address;
    return this;
  }

  attach(
    path: string,
    options: { as?: string; mime?: string } = {},
  ): this {
    this.#attachments.push({ path, as: options.as, mime: options.mime });
    return this;
  }

  attachMany(
    paths: Array<string | { path: string; as?: string; mime?: string }>,
  ): this {
    for (const item of paths) {
      if (typeof item === "string") this.attach(item);
      else this.attach(item.path, { as: item.as, mime: item.mime });
    }
    return this;
  }

  attachData(
    data: string | Uint8Array,
    name: string,
    options: { mime?: string } = {},
  ): this {
    this.#rawAttachments.push({
      filename: name,
      content: data,
      contentType: options.mime,
    });
    return this;
  }

  async attachFromStorage(
    path: string,
    name?: string,
    options: { mime?: string } = {},
  ): Promise<this> {
    return this.attachFromStorageDisk(undefined, path, name, options);
  }

  async attachFromStorageDisk(
    _disk: string | undefined,
    path: string,
    name?: string,
    options: { mime?: string } = {},
  ): Promise<this> {
    const bytes = await readFile(path);
    return this.attachData(bytes, name ?? basename(path), options);
  }

  when(
    condition: boolean | (() => boolean),
    callback: (message: this) => void,
  ): this {
    const ok = typeof condition === "function" ? condition() : condition;
    if (ok) callback(this);
    return this;
  }

  unless(
    condition: boolean | (() => boolean),
    callback: (message: this) => void,
  ): this {
    const ok = typeof condition === "function" ? condition() : condition;
    if (!ok) callback(this);
    return this;
  }

  with(key: string | Record<string, unknown>, value?: unknown): this {
    if (typeof key === "object") Object.assign(this.#viewData, key);
    else this.#viewData[key] = value;
    return this;
  }

  /** No-op without a Symfony Mime stack. */
  withSymfonyMessage(_callback: (message: unknown) => void): this {
    return this;
  }

  formatLine(line: string | string[]): string[] {
    const value = Array.isArray(line) ? line.join(" ") : line;
    return value.split(/\n/).map((part) => part.trimEnd());
  }

  parseAddresses(
    address: AddressInput | AddressInput[] | Record<string, string>,
  ): string[] {
    if (typeof address === "string") return [address];
    if (Array.isArray(address)) {
      return address.map((a) => formatAddress(a)!);
    }
    if (address && typeof address === "object" && "address" in address) {
      return [formatAddress(address as AddressInput)!];
    }
    return Object.entries(address as Record<string, string>).map(([email, name]) =>
      name ? `${name} <${email}>` : email,
    );
  }

  arrayOfAddresses(
    address: AddressInput | AddressInput[] | Record<string, string>,
  ): string[] {
    return this.parseAddresses(address);
  }

  /** View / markdown data bag. */
  data(): Record<string, unknown> {
    return {
      level: this.#level,
      subject: this.#subject,
      greeting: this.#greeting,
      salutation: this.#salutation,
      introLines: [...this.#introLines],
      outroLines: [...this.#outroLines],
      actionText: this.#actionText,
      actionUrl: this.#actionUrl,
      markdown: this.#markdown,
      theme: this.#theme,
      view: this.#view,
      mailer: this.#mailer,
      priority: this.#priority,
      tags: [...this.#tags],
      metadata: { ...this.#metadata },
      ...this.#viewData,
    };
  }

  /** Render themed HTML from greeting / lines / action (and optional brand `with()` data). */
  render(): string {
    return renderNotificationMailHtml({
      level: this.#level,
      greeting: this.#greeting,
      introLines: this.#introLines,
      actionText: this.#actionText,
      actionUrl: this.#actionUrl,
      outroLines: this.#outroLines,
      salutation: this.#salutation,
      ...(this.#viewData.appName != null
        ? { appName: String(this.#viewData.appName) }
        : {}),
      ...(this.#viewData.logoUrl != null
        ? { logoUrl: String(this.#viewData.logoUrl) }
        : {}),
      ...(this.#viewData.headerUrl != null
        ? { headerUrl: String(this.#viewData.headerUrl) }
        : {}),
      ...(this.#viewData.year != null
        ? { year: Number(this.#viewData.year) }
        : {}),
    });
  }

  /** Plain-text body mirroring greeting / lines / action / salutation. */
  text(): string {
    return this.#plainText();
  }

  /** Build a raw mailer payload for the given notifiable. */
  async toMessage(notifiable?: Notifiable): Promise<RawMailMessage> {
    const to =
      this.#to ??
      (notifiable
        ? routeEmail(notifiable)
        : undefined);
    if (to == null) {
      throw new Error("MailMessage has no recipient.");
    }

    const attachments: MailAttachment[] = [...this.#rawAttachments];
    for (const a of this.#attachments) {
      const content = await readFile(a.path);
      attachments.push({
        filename: a.as ?? basename(a.path),
        content,
        contentType: a.mime,
      });
    }

    const text = this.#plainText();
    return {
      to,
      subject: this.#subject ?? "Notification",
      html: this.render(),
      text,
      from: formatAddress(this.#from),
      cc: formatAddresses(this.#cc),
      bcc: formatAddresses(this.#bcc),
      replyTo: formatAddresses(this.#replyTo),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  #plainText(): string {
    const parts: string[] = [];
    if (this.#greeting) parts.push(this.#greeting);
    parts.push(...this.#introLines);
    if (this.#actionText && this.#actionUrl) {
      parts.push(`${this.#actionText}: ${this.#actionUrl}`);
    }
    parts.push(...this.#outroLines);
    if (this.#salutation) parts.push(this.#salutation);
    return parts.join("\n");
  }

  #pushAddresses(
    target: AddressInput[],
    address: AddressInput | AddressInput[],
    name?: string,
  ): void {
    if (Array.isArray(address)) {
      target.push(...address);
      return;
    }
    if (typeof address === "string" && name) {
      target.push({ address, name });
      return;
    }
    target.push(address);
  }
}

function routeEmail(notifiable: Notifiable): string | string[] | undefined {
  const routed = notifiable.routeNotificationFor?.("mail");
  if (routed != null) return routed;
  if (typeof notifiable.email === "string") return notifiable.email;
  return undefined;
}

function formatAddress(input?: AddressInput): string | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") return input;
  return input.name ? `${input.name} <${input.address}>` : input.address;
}

function formatAddresses(list: AddressInput[]): string[] | undefined {
  if (list.length === 0) return undefined;
  return list.map((a) => formatAddress(a)!);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
