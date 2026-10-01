/**
 * Slack notification message (Incoming Webhook / Block Kit–friendly payload).
 */
export class SlackMessage {
  #text?: string;
  #channel?: string;
  #username?: string;
  #iconEmoji?: string;
  #iconUrl?: string;
  #level: "info" | "success" | "warning" | "error" = "info";
  #attachments: Array<Record<string, unknown>> = [];
  #blocks: unknown[] = [];
  #payload: Record<string, unknown> = {};

  text(value: string): this {
    this.#text = value;
    return this;
  }

  content(value: string): this {
    return this.text(value);
  }

  /** Override webhook destination channel (when the webhook allows it). */
  to(channel: string): this {
    this.#channel = channel;
    return this;
  }

  from(username: string): this {
    this.#username = username;
    return this;
  }

  iconEmoji(emoji: string): this {
    this.#iconEmoji = emoji;
    return this;
  }

  iconUrl(url: string): this {
    this.#iconUrl = url;
    return this;
  }

  success(): this {
    this.#level = "success";
    return this;
  }

  warning(): this {
    this.#level = "warning";
    return this;
  }

  error(): this {
    this.#level = "error";
    return this;
  }

  level(value: "info" | "success" | "warning" | "error"): this {
    this.#level = value;
    return this;
  }

  attachment(callback: (attachment: Record<string, unknown>) => void): this {
    const item: Record<string, unknown> = {};
    callback(item);
    this.#attachments.push(item);
    return this;
  }

  attachments(
    callback: (attachment: Record<string, unknown>) => void,
  ): this {
    return this.attachment(callback);
  }

  headerBlock(text: string): this {
    this.#blocks.push({
      type: "header",
      text: { type: "plain_text", text },
    });
    return this;
  }

  dividerBlock(): this {
    this.#blocks.push({ type: "divider" });
    return this;
  }

  sectionBlock(callback: (block: { text: (value: string) => void }) => void): this {
    let text = "";
    callback({
      text(value: string) {
        text = value;
      },
    });
    this.#blocks.push({
      type: "section",
      text: { type: "mrkdwn", text },
    });
    return this;
  }

  contextBlock(callback: (block: { text: (value: string) => void }) => void): this {
    const elements: Array<{ type: string; text: string }> = [];
    callback({
      text(value: string) {
        elements.push({ type: "mrkdwn", text: value });
      },
    });
    this.#blocks.push({ type: "context", elements });
    return this;
  }

  /** Merge raw Slack API fields (blocks, attachments, …). */
  with(payload: Record<string, unknown>): this {
    Object.assign(this.#payload, payload);
    return this;
  }

  toPayload(): Record<string, unknown> {
    const out: Record<string, unknown> = { ...this.#payload };
    if (this.#text != null) out.text = this.#text;
    if (this.#channel != null) out.channel = this.#channel;
    if (this.#username != null) out.username = this.#username;
    if (this.#iconEmoji != null) out.icon_emoji = this.#iconEmoji;
    if (this.#iconUrl != null) out.icon_url = this.#iconUrl;
    if (this.#attachments.length > 0) {
      out.attachments = this.#attachments.map((a) => ({
        color:
          this.#level === "success"
            ? "good"
            : this.#level === "warning"
              ? "warning"
              : this.#level === "error"
                ? "danger"
                : undefined,
        ...a,
      }));
    }
    if (this.#blocks.length > 0) out.blocks = this.#blocks;
    return out;
  }
}
