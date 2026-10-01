/**
 * Mailer contract.
 */
export type MailAttachment = {
  filename: string;
  content: string | Uint8Array;
  contentType?: string;
  /** Content-ID for inline embeds (`cid:…`). */
  cid?: string;
};

export interface MailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  attachments?: MailAttachment[];
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}
