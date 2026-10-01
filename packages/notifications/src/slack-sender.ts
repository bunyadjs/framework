import type { SlackMessage } from "./messages/slack-message.ts";

export type SlackSender = {
  send(webhookUrl: string, message: SlackMessage): Promise<void>;
};

export type SentSlackMessage = {
  webhookUrl: string;
  payload: Record<string, unknown>;
};

/** In-memory Slack sender for tests. */
export class ArraySlackSender implements SlackSender {
  readonly messages: SentSlackMessage[] = [];

  async send(webhookUrl: string, message: SlackMessage): Promise<void> {
    this.messages.push({ webhookUrl, payload: message.toPayload() });
  }
}

/** POST JSON to a Slack Incoming Webhook URL. */
export class HttpSlackSender implements SlackSender {
  async send(webhookUrl: string, message: SlackMessage): Promise<void> {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.toPayload()),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook failed (${res.status}).`);
    }
  }
}
