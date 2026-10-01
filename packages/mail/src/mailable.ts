import type { Mailer, MailMessage, MailAttachment } from "@bunyad/contracts";
import {
  asAddressField,
  mergeAddressLists,
  normalizeAddresses,
  type MailAddress,
} from "./addresses.ts";
import { renderMarkdownMail, getMailMarkdownDefaults } from "./theme.ts";
import { renderMailView } from "./view-renderer.ts";

export type MailableContent = {
  html?: string;
  text?: string;
  view?: string;
  markdown?: string;
  with?: Record<string, unknown>;
};

export type MailableEnvelope = {
  to: string | string[];
  subject: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
};

/** Minimal queue surface — satisfied by `@bunyad/queue` `QueueManager`. */
export type MailQueue = {
  push(name: string, data: unknown, queue?: string): Promise<string>;
  register(
    name: string,
    handler: (data: unknown) => void | Promise<void>,
  ): unknown;
};

/** Optional storage reader for `attachFromStorage` (wire `Storage` from the app). */
export type MailStorage = {
  get(path: string): Promise<Uint8Array>;
  disk?(name: string): { get(path: string): Promise<Uint8Array> };
};

export const SEND_QUEUED_MAILABLE = "SendQueuedMailable";

/** Marker interface for queued mailables (optional alternative to `shouldQueue`). */
export interface ShouldQueue {
  shouldQueue: true;
}

export type MailableConstructor = new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => Mailable;

type PendingAttachment =
  | { kind: "data"; attachment: MailAttachment }
  | {
      kind: "path";
      path: string;
      filename: string;
      contentType?: string;
      cid?: string;
    };

type SerializedAttachment = {
  filename: string;
  content: string;
  contentType?: string;
  cid?: string;
  encoding: "utf8" | "base64";
};

type SerializedMailMessage = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  attachments?: SerializedAttachment[];
};

type SerializedPending =
  | {
      kind: "path";
      path: string;
      filename: string;
      contentType?: string;
      cid?: string;
    }
  | {
      kind: "data";
      filename: string;
      content: string;
      contentType?: string;
      cid?: string;
      encoding: "utf8" | "base64";
    };

export type QueuedMailablePayload =
  | { kind: "message"; message: SerializedMailMessage; delay?: number }
  | {
      kind: "mailable";
      name: string;
      props: Record<string, unknown>;
      pending: SerializedPending[];
      delay?: number;
    };

type MailableOverrides = {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  replyTo?: string[];
  subject?: string;
  locale?: string;
  mailer?: string;
  priority?: number;
  tags?: string[];
  metadata?: Record<string, string>;
  view?: string;
  markdown?: string;
  text?: string;
  html?: string;
  with?: Record<string, unknown>;
  callbacks?: Array<(mailable: Mailable) => void>;
};

function isViewName(value: string): boolean {
  return /^[\w./-]+$/.test(value) && !value.includes("\n");
}

function serializeMailMessage(message: MailMessage): SerializedMailMessage {
  return {
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    from: message.from,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo,
    attachments: message.attachments?.map((a) => {
      if (typeof a.content === "string") {
        return {
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          cid: a.cid,
          encoding: "utf8" as const,
        };
      }
      return {
        filename: a.filename,
        content: Buffer.from(a.content).toString("base64"),
        contentType: a.contentType,
        cid: a.cid,
        encoding: "base64" as const,
      };
    }),
  };
}

function deserializeMailMessage(data: unknown): MailMessage {
  const msg = data as SerializedMailMessage;
  return {
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    from: msg.from,
    cc: msg.cc,
    bcc: msg.bcc,
    replyTo: msg.replyTo,
    attachments: msg.attachments?.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      cid: a.cid,
      content:
        a.encoding === "base64"
          ? Uint8Array.from(Buffer.from(a.content, "base64"))
          : a.content,
    })),
  };
}

function serializePending(items: PendingAttachment[]): SerializedPending[] {
  return items.map((item) => {
    if (item.kind === "path") {
      return {
        kind: "path" as const,
        path: item.path,
        filename: item.filename,
        contentType: item.contentType,
        cid: item.cid,
      };
    }
    const content = item.attachment.content;
    if (typeof content === "string") {
      return {
        kind: "data" as const,
        filename: item.attachment.filename,
        content,
        contentType: item.attachment.contentType,
        cid: item.attachment.cid,
        encoding: "utf8" as const,
      };
    }
    return {
      kind: "data" as const,
      filename: item.attachment.filename,
      content: Buffer.from(content).toString("base64"),
      contentType: item.attachment.contentType,
      cid: item.attachment.cid,
      encoding: "base64" as const,
    };
  });
}

function deserializePending(items: SerializedPending[]): PendingAttachment[] {
  return items.map((item) => {
    if (item.kind === "path") {
      return {
        kind: "path" as const,
        path: item.path,
        filename: item.filename,
        contentType: item.contentType,
        cid: item.cid,
      };
    }
    return {
      kind: "data" as const,
      attachment: {
        filename: item.filename,
        contentType: item.contentType,
        cid: item.cid,
        content:
          item.encoding === "base64"
            ? Uint8Array.from(Buffer.from(item.content, "base64"))
            : item.content,
      },
    };
  });
}

function plainProps(mailable: Mailable): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = mailable as unknown as Record<string, unknown>;
  for (const key of Object.keys(mailable)) {
    out[key] = props[key];
  }
  return out;
}

const pendingByMailable = new WeakMap<Mailable, PendingAttachment[]>();
const overridesByMailable = new WeakMap<Mailable, MailableOverrides>();

function pendingOf(mailable: Mailable): PendingAttachment[] {
  let list = pendingByMailable.get(mailable);
  if (!list) {
    list = [];
    pendingByMailable.set(mailable, list);
  }
  return list;
}

function overridesOf(mailable: Mailable): MailableOverrides {
  let o = overridesByMailable.get(mailable);
  if (!o) {
    o = {};
    overridesByMailable.set(mailable, o);
  }
  return o;
}

function assertContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Failed asserting that ${label} contains [${needle}].`);
  }
}

function assertNotContains(
  haystack: string,
  needle: string,
  label: string,
): void {
  if (haystack.includes(needle)) {
    throw new Error(
      `Failed asserting that ${label} does not contain [${needle}].`,
    );
  }
}

function assertSeeInOrder(
  haystack: string,
  needles: string[],
  label: string,
): void {
  let from = 0;
  for (const needle of needles) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) {
      throw new Error(
        `Failed asserting that ${label} contains [${needle}] in order.`,
      );
    }
    from = idx + needle.length;
  }
}

function hasAddress(
  field: string | string[] | undefined,
  address: string,
): boolean {
  if (field == null) return false;
  const list = Array.isArray(field) ? field : [field];
  return list.includes(address);
}

const mailableRegistry = new Map<string, MailableConstructor>();
const namedMailers = new Map<string, Mailer>();

let alwaysFrom: string | undefined;
let alwaysTo: string | undefined;
let alwaysReplyTo: string | undefined;
let alwaysReturnPath: string | undefined;
let mailStorage: MailStorage | undefined;

/** Register a mailable class so queued jobs can revive it by name. */
export function registerMailable(Ctor: MailableConstructor): void {
  mailableRegistry.set(Ctor.name, Ctor);
}

export function getMailable(name: string): MailableConstructor | undefined {
  return mailableRegistry.get(name);
}

export function registerMailer(name: string, mailer: Mailer): void {
  namedMailers.set(name, mailer);
}

export function getNamedMailer(name: string): Mailer {
  const mailer = namedMailers.get(name);
  if (!mailer) {
    throw new Error(`Mailer [${name}] is not registered.`);
  }
  return mailer;
}

/** Drop all named mailers (tests / provider re-boot). */
export function clearNamedMailers(): void {
  namedMailers.clear();
}

export function hasNamedMailer(name: string): boolean {
  return namedMailers.has(name);
}

export function setMailStorage(storage: MailStorage | undefined): void {
  mailStorage = storage;
}

export function alwaysFromAddress(address: string | null): void {
  alwaysFrom = address ?? undefined;
}

export function alwaysToAddress(address: string | null): void {
  alwaysTo = address ?? undefined;
}

export function alwaysReplyToAddress(address: string | null): void {
  alwaysReplyTo = address ?? undefined;
}

export function alwaysReturnPathAddress(address: string | null): void {
  alwaysReturnPath = address ?? undefined;
}

/** Apply global alwaysFrom / alwaysTo / alwaysReplyTo defaults. */
export function applyAlwaysDefaults(message: MailMessage): MailMessage {
  const next: MailMessage = { ...message };
  if (alwaysFrom && !next.from) next.from = alwaysFrom;
  if (alwaysTo) next.to = alwaysTo;
  if (alwaysReplyTo && !next.replyTo) next.replyTo = alwaysReplyTo;
  if (alwaysReturnPath && !(next as { returnPath?: string }).returnPath) {
    (next as { returnPath?: string }).returnPath = alwaysReturnPath;
  }
  return next;
}

/**
 * Buildable mail message.
 */
export abstract class Mailable {
  /**
   * When true, `mail()` pushes a queue job instead of sending inline.
   * Requires `setMailQueue()`.
   */
  shouldQueue = false;

  /**
   * Queue name when `shouldQueue` is true.
   * Named `queueName` so it does not collide with the `queue()` method.
   */
  queueName = "default";

  /** Delay in seconds when using `later()`. */
  delay?: number;

  abstract envelope(): MailableEnvelope;
  abstract content(): MailableContent;

  to(users: MailAddress | MailAddress[]): this {
    overridesOf(this).to = normalizeAddresses(users);
    return this;
  }

  cc(users: MailAddress | MailAddress[]): this {
    overridesOf(this).cc = normalizeAddresses(users);
    return this;
  }

  bcc(users: MailAddress | MailAddress[]): this {
    overridesOf(this).bcc = normalizeAddresses(users);
    return this;
  }

  from(address: string): this {
    overridesOf(this).from = address;
    return this;
  }

  replyTo(users: MailAddress | MailAddress[]): this {
    overridesOf(this).replyTo = normalizeAddresses(users);
    return this;
  }

  subject(subject: string): this {
    overridesOf(this).subject = subject;
    return this;
  }

  locale(locale: string): this {
    overridesOf(this).locale = locale;
    return this;
  }

  mailer(name: string): this {
    overridesOf(this).mailer = name;
    return this;
  }

  /** Alias of {@link mailer}. */
  usesMailer(name: string): this {
    return this.mailer(name);
  }

  priority(level: number): this {
    overridesOf(this).priority = level;
    return this;
  }

  tag(value: string): this {
    const o = overridesOf(this);
    o.tags ??= [];
    o.tags.push(value);
    return this;
  }

  metadata(key: string, value: string): this {
    const o = overridesOf(this);
    o.metadata ??= {};
    o.metadata[key] = value;
    return this;
  }

  view(name: string, data: Record<string, unknown> = {}): this {
    const o = overridesOf(this);
    o.view = name;
    o.with = { ...(o.with ?? {}), ...data };
    return this;
  }

  markdown(name: string, data: Record<string, unknown> = {}): this {
    const o = overridesOf(this);
    o.markdown = name;
    o.with = { ...(o.with ?? {}), ...data };
    return this;
  }

  text(viewOrText: string, data?: Record<string, unknown>): this {
    const o = overridesOf(this);
    o.text = viewOrText;
    if (data) o.with = { ...(o.with ?? {}), ...data };
    return this;
  }

  html(html: string): this {
    overridesOf(this).html = html;
    return this;
  }

  with(key: string | Record<string, unknown>, value?: unknown): this {
    const o = overridesOf(this);
    o.with ??= {};
    if (typeof key === "object") Object.assign(o.with, key);
    else o.with[key] = value;
    return this;
  }

  when(
    condition: boolean | (() => boolean),
    callback: (mailable: this) => void,
  ): this {
    const ok = typeof condition === "function" ? condition() : condition;
    if (ok) callback(this);
    return this;
  }

  unless(
    condition: boolean | (() => boolean),
    callback: (mailable: this) => void,
  ): this {
    const ok = typeof condition === "function" ? condition() : condition;
    if (!ok) callback(this);
    return this;
  }

  tap(callback: (mailable: this) => void): this {
    callback(this);
    return this;
  }

  withLocale(locale: string, callback: (mailable: this) => void): this {
    const previous = overridesOf(this).locale;
    this.locale(locale);
    callback(this);
    if (previous == null) delete overridesOf(this).locale;
    else overridesOf(this).locale = previous;
    return this;
  }

  /** Attach a file from disk. */
  attach(
    path: string,
    options: { as?: string; mime?: string } = {},
  ): this {
    pendingOf(this).push({
      kind: "path",
      path,
      filename: options.as ?? path.split(/[/\\]/).pop() ?? "file",
      contentType: options.mime,
    });
    return this;
  }

  /** Attach many paths or `{ path, as?, mime? }` entries. */
  attachMany(
    paths: Array<string | { path: string; as?: string; mime?: string }>,
  ): this {
    for (const item of paths) {
      if (typeof item === "string") this.attach(item);
      else this.attach(item.path, { as: item.as, mime: item.mime });
    }
    return this;
  }

  /** Attach raw bytes / string. */
  attachData(
    data: string | Uint8Array,
    filename: string,
    options: { mime?: string } = {},
  ): this {
    pendingOf(this).push({
      kind: "data",
      attachment: {
        filename,
        content: data,
        contentType: options.mime,
      },
    });
    return this;
  }

  /** Attach a file from the configured mail storage. */
  async attachFromStorage(
    path: string,
    name?: string,
    options: { mime?: string } = {},
  ): Promise<this> {
    return this.attachFromStorageDisk(undefined, path, name, options);
  }

  async attachFromStorageDisk(
    disk: string | undefined,
    path: string,
    name?: string,
    options: { mime?: string } = {},
  ): Promise<this> {
    if (!mailStorage) {
      throw new Error("Mail storage is not configured. Call setMailStorage().");
    }
    const bytes = disk
      ? await mailStorage.disk!(disk).get(path)
      : await mailStorage.get(path);
    return this.attachData(
      bytes,
      name ?? path.split(/[/\\]/).pop() ?? "file",
      { mime: options.mime },
    );
  }

  /** Inline embed from disk; returns `cid:…` for HTML. */
  embed(path: string, options: { mime?: string } = {}): string {
    const cid = `embed-${crypto.randomUUID()}@bunyad`;
    pendingOf(this).push({
      kind: "path",
      path,
      filename: path.split(/[/\\]/).pop() ?? "embed",
      contentType: options.mime,
      cid,
    });
    return `cid:${cid}`;
  }

  /** Inline embed from raw data; returns `cid:…`. */
  embedData(
    data: string | Uint8Array,
    filename: string,
    options: { mime?: string } = {},
  ): string {
    const cid = `embed-${crypto.randomUUID()}@bunyad`;
    pendingOf(this).push({
      kind: "data",
      attachment: {
        filename,
        content: data,
        contentType: options.mime,
        cid,
      },
    });
    return `cid:${cid}`;
  }

  /** @internal Revive a queued mailable instance. */
  static hydrate(
    Ctor: MailableConstructor,
    props: Record<string, unknown>,
    pending: SerializedPending[],
  ): Mailable {
    const instance = Object.create(Ctor.prototype) as Mailable;
    Object.assign(instance, props);
    pendingByMailable.set(instance, deserializePending(pending));
    return instance;
  }

  async toMessage(): Promise<MailMessage> {
    const env = this.envelope();
    const body = this.content();
    const over = overridesOf(this);
    const data = { ...(body.with ?? {}), ...(over.with ?? {}) };

    let html = over.html ?? body.html;
    let text = over.text ?? body.text;

    const viewName = over.view ?? body.view;
    if (viewName) {
      html = renderMailView(viewName, data);
    }

    const markdownSrc = over.markdown ?? body.markdown;
    if (markdownSrc) {
      const md = isViewName(markdownSrc)
        ? renderMailView(markdownSrc, data)
        : markdownSrc;
      const themed = renderMarkdownMail(md, getMailMarkdownDefaults());
      html = themed.html;
      text ??= themed.text || md;
    }

    if (over.text && isViewName(over.text) && !body.text) {
      text = renderMailView(over.text, data);
    }

    const attachments: MailAttachment[] = [];
    for (const item of pendingOf(this)) {
      if (item.kind === "data") {
        attachments.push(item.attachment);
        continue;
      }
      const file = Bun.file(item.path);
      const bytes = new Uint8Array(await file.arrayBuffer());
      attachments.push({
        filename: item.filename,
        content: bytes,
        contentType: item.contentType ?? (file.type || undefined),
        cid: item.cid,
      });
    }

    const to = over.to?.length ? over.to : normalizeAddresses(env.to);
    const cc = mergeAddressLists(env.cc, over.cc);
    const bcc = mergeAddressLists(env.bcc, over.bcc);
    const replyTo = mergeAddressLists(env.replyTo, over.replyTo);

    return applyAlwaysDefaults({
      to: asAddressField(to) ?? "",
      subject: over.subject ?? env.subject,
      from: over.from ?? env.from,
      cc: asAddressField(cc),
      bcc: asAddressField(bcc),
      replyTo: asAddressField(replyTo),
      html,
      text,
      attachments: attachments.length ? attachments : undefined,
    });
  }

  /** Rendered HTML (or text fallback) without sending. */
  async render(): Promise<string> {
    const message = await this.toMessage();
    return message.html ?? message.text ?? "";
  }

  async send(mailer?: Mailer): Promise<void> {
    const over = overridesOf(this);
    const m =
      mailer ??
      (over.mailer ? getNamedMailer(over.mailer) : getMailer());
    await m.send(await this.toMessage());
  }

  async queue(): Promise<void> {
    this.shouldQueue = true;
    await mail(this);
  }

  /** Queue on a named queue. */
  async queueOn(name: string): Promise<void> {
    this.queueName = name;
    this.shouldQueue = true;
    await mail(this);
  }

  /** Alias of setting the queue name for a later `queue` / `Mail.queue`. */
  onQueue(name: string): this {
    this.queueName = name;
    return this;
  }

  async later(delay: number): Promise<void> {
    this.delay = delay;
    this.shouldQueue = true;
    await mail(this);
  }

  async laterOn(name: string, delay: number): Promise<void> {
    this.queueName = name;
    return this.later(delay);
  }

  hasFrom(address: string): boolean {
    const over = overridesOf(this);
    const from = over.from ?? this.envelope().from;
    return from === address;
  }

  hasTo(address: string): boolean {
    return this.hasRecipient("to", address);
  }

  hasCc(address: string): boolean {
    return this.hasRecipient("cc", address);
  }

  hasBcc(address: string): boolean {
    return this.hasRecipient("bcc", address);
  }

  hasReplyTo(address: string): boolean {
    return this.hasRecipient("replyTo", address);
  }

  hasRecipient(
    field: "to" | "cc" | "bcc" | "replyTo",
    address: string,
  ): boolean {
    const over = overridesOf(this);
    const env = this.envelope();
    let list: string[] = [];
    if (field === "to") {
      list = over.to?.length ? over.to : normalizeAddresses(env.to);
    } else if (field === "cc") {
      list = mergeAddressLists(env.cc, over.cc);
    } else if (field === "bcc") {
      list = mergeAddressLists(env.bcc, over.bcc);
    } else {
      list = mergeAddressLists(env.replyTo, over.replyTo);
    }
    return list.includes(address);
  }

  hasSubject(subject: string): boolean {
    const over = overridesOf(this);
    return (over.subject ?? this.envelope().subject) === subject;
  }

  hasTag(value: string): boolean {
    return (overridesOf(this).tags ?? []).includes(value);
  }

  hasMetadata(key: string, value?: string): boolean {
    const meta = overridesOf(this).metadata ?? {};
    if (!(key in meta)) return false;
    return value == null ? true : meta[key] === value;
  }

  hasAttachment(pathOrName: string): boolean {
    const needle = pathOrName.split(/[/\\]/).pop() ?? pathOrName;
    return pendingOf(this).some((item) => {
      if (item.kind === "path") {
        return (
          item.filename === needle ||
          item.path === pathOrName ||
          item.path.endsWith(pathOrName)
        );
      }
      return item.attachment.filename === needle;
    });
  }

  hasAttachedData(data: string | Uint8Array, filename: string): boolean {
    const expected =
      typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    return pendingOf(this).some((item) => {
      if (item.kind !== "data") return false;
      if (item.attachment.filename !== filename) return false;
      const content = item.attachment.content;
      const actual =
        typeof content === "string"
          ? content
          : Buffer.from(content).toString("utf8");
      return actual === expected;
    });
  }

  hasAttachmentFromStorage(path: string): boolean {
    return this.hasAttachment(path);
  }

  hasAttachmentFromStorageDisk(_disk: string, path: string): boolean {
    return this.hasAttachment(path);
  }

  async assertFrom(address: string): Promise<this> {
    const msg = await this.toMessage();
    if (msg.from !== address) {
      throw new Error(`Failed asserting that from is [${address}].`);
    }
    return this;
  }

  async assertTo(address: string): Promise<this> {
    return this.assertHasTo(address);
  }

  async assertHasTo(address: string): Promise<this> {
    const msg = await this.toMessage();
    if (!hasAddress(msg.to, address)) {
      throw new Error(`Failed asserting that to includes [${address}].`);
    }
    return this;
  }

  async assertHasCc(address: string): Promise<this> {
    const msg = await this.toMessage();
    if (!hasAddress(msg.cc, address)) {
      throw new Error(`Failed asserting that cc includes [${address}].`);
    }
    return this;
  }

  async assertHasBcc(address: string): Promise<this> {
    const msg = await this.toMessage();
    if (!hasAddress(msg.bcc, address)) {
      throw new Error(`Failed asserting that bcc includes [${address}].`);
    }
    return this;
  }

  async assertHasReplyTo(address: string): Promise<this> {
    const msg = await this.toMessage();
    if (!hasAddress(msg.replyTo, address)) {
      throw new Error(`Failed asserting that replyTo includes [${address}].`);
    }
    return this;
  }

  async assertHasSubject(subject: string): Promise<this> {
    const msg = await this.toMessage();
    if (msg.subject !== subject) {
      throw new Error(`Failed asserting that subject is [${subject}].`);
    }
    return this;
  }

  async assertHasTag(value: string): Promise<this> {
    if (!this.hasTag(value)) {
      throw new Error(`Failed asserting that tag [${value}] exists.`);
    }
    return this;
  }

  async assertHasMetadata(key: string, value?: string): Promise<this> {
    if (!this.hasMetadata(key, value)) {
      throw new Error(`Failed asserting that metadata [${key}] matches.`);
    }
    return this;
  }

  async assertSeeInHtml(text: string): Promise<this> {
    const msg = await this.toMessage();
    assertContains(msg.html ?? "", text, "HTML");
    return this;
  }

  async assertDontSeeInHtml(text: string): Promise<this> {
    const msg = await this.toMessage();
    assertNotContains(msg.html ?? "", text, "HTML");
    return this;
  }

  async assertSeeInOrderInHtml(texts: string[]): Promise<this> {
    const msg = await this.toMessage();
    assertSeeInOrder(msg.html ?? "", texts, "HTML");
    return this;
  }

  async assertSeeInText(text: string): Promise<this> {
    const msg = await this.toMessage();
    assertContains(msg.text ?? "", text, "text");
    return this;
  }

  async assertDontSeeInText(text: string): Promise<this> {
    const msg = await this.toMessage();
    assertNotContains(msg.text ?? "", text, "text");
    return this;
  }

  async assertSeeInOrderInText(texts: string[]): Promise<this> {
    const msg = await this.toMessage();
    assertSeeInOrder(msg.text ?? "", texts, "text");
    return this;
  }

  async assertHasAttachment(pathOrName: string): Promise<this> {
    const msg = await this.toMessage();
    const needle = pathOrName.split(/[/\\]/).pop() ?? pathOrName;
    const hit = msg.attachments?.some(
      (a) => a.filename === needle || a.filename === pathOrName,
    );
    if (!hit) {
      throw new Error(`Failed asserting that attachment [${needle}] exists.`);
    }
    return this;
  }

  async assertHasAttachedData(
    data: string | Uint8Array,
    filename: string,
  ): Promise<this> {
    const msg = await this.toMessage();
    const expected =
      typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    const hit = msg.attachments?.some((a) => {
      if (a.filename !== filename) return false;
      const content =
        typeof a.content === "string"
          ? a.content
          : Buffer.from(a.content).toString("utf8");
      return content === expected;
    });
    if (!hit) {
      throw new Error(
        `Failed asserting that attached data [${filename}] matches.`,
      );
    }
    return this;
  }

  async assertHasAttachmentFromStorage(path: string): Promise<this> {
    if (!this.hasAttachmentFromStorage(path)) {
      throw new Error(
        `Failed asserting that storage attachment [${path}] exists.`,
      );
    }
    return this;
  }

  async assertHasAttachmentFromStorageDisk(
    disk: string,
    path: string,
  ): Promise<this> {
    if (!this.hasAttachmentFromStorageDisk(disk, path)) {
      throw new Error(
        `Failed asserting that storage disk attachment [${disk}:${path}] exists.`,
      );
    }
    return this;
  }

  async assertHasNoAttachments(): Promise<this> {
    const msg = await this.toMessage();
    if (msg.attachments?.length) {
      throw new Error("Failed asserting that mailable has no attachments.");
    }
    return this;
  }

  /** Build class-form queue payload (caller must ensure registration). */
  toQueuePayload(): QueuedMailablePayload {
    return {
      kind: "mailable",
      name: this.constructor.name,
      props: plainProps(this),
      pending: serializePending(pendingOf(this)),
      delay: this.delay,
    };
  }
}

let defaultMailer: Mailer | undefined;
let mailQueue: MailQueue | undefined;

export function setMailer(mailer: Mailer): void {
  defaultMailer = mailer;
}

export function getMailer(): Mailer {
  return defaultMailer!;
}

async function handleQueuedMailable(data: unknown): Promise<void> {
  if (
    data &&
    typeof data === "object" &&
    "subject" in data &&
    !("kind" in data)
  ) {
    await getMailer().send(deserializeMailMessage(data));
    return;
  }

  const payload = data as QueuedMailablePayload;
  if (payload.kind === "message") {
    await getMailer().send(deserializeMailMessage(payload.message));
    return;
  }

  const Ctor = mailableRegistry.get(payload.name);
  if (!Ctor) {
    throw new Error(
      `Mailable [${payload.name}] is not registered. Call registerMailable().`,
    );
  }
  const mailable = Mailable.hydrate(Ctor, payload.props, payload.pending);
  await mailable.send();
}

/** Live a queue so mailables with `shouldQueue` can be deferred. */
export function setMailQueue(queue: MailQueue): void {
  mailQueue = queue;
  queue.register(SEND_QUEUED_MAILABLE, handleQueuedMailable);
}

export function getMailQueue(): MailQueue | undefined {
  return mailQueue;
}

/** `Mail::send($mailable)` — queues when `shouldQueue` is true. */
export async function mail(mailable: Mailable): Promise<void> {
  if (mailable.shouldQueue) {
    if (!mailQueue) {
      throw new Error("Mail queue is not configured. Call setMailQueue().");
    }
    const name = mailable.constructor.name;
    const payload: QueuedMailablePayload = mailableRegistry.has(name)
      ? mailable.toQueuePayload()
      : {
          kind: "message",
          message: serializeMailMessage(await mailable.toMessage()),
          delay: mailable.delay,
        };
    await mailQueue.push(SEND_QUEUED_MAILABLE, payload, mailable.queueName);
    return;
  }
  await mailable.send();
}
