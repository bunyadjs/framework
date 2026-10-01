import type { Mailer, MailMessage } from "@bunyad/contracts";

/**
 * `BufferSource` isn't ambient here (base tsconfig `lib` is ESNext-only,
 * no DOM) — derive it from the real WebCrypto `importKey` parameter
 * instead of widening `lib` project-wide.
 */
type BufferSourceLike = Parameters<typeof crypto.subtle.importKey>[1];

export type SesMailerOptions = {
  /** AWS access key id. */
  accessKeyId: string;
  /** AWS secret access key. */
  secretAccessKey: string;
  /** AWS region (e.g. `us-east-1`). */
  region: string;
  from: string;
  /** Override SES endpoint (tests). */
  endpoint?: string;
  fetch?: typeof fetch;
  /** Inject clock for SigV4 tests. */
  now?: () => Date;
};

function toAddresses(to: string | string[]): string[] {
  return Array.isArray(to) ? to : [to];
}

function amzDate(d: Date): { amz: string; date: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, date: iso.slice(0, 8) };
}

async function hmac(
  key: ArrayBuffer | Uint8Array | string,
  data: string,
): Promise<ArrayBuffer> {
  const keyData =
    typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData as BufferSourceLike,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(data),
  );
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Send mail via Amazon SES v2 `SendEmail` (SigV4-signed HTTPS).
 */
export class SesMailer implements Mailer {
  readonly #accessKeyId: string;
  readonly #secretAccessKey: string;
  readonly #region: string;
  readonly #from: string;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: SesMailerOptions) {
    this.#accessKeyId = options.accessKeyId;
    this.#secretAccessKey = options.secretAccessKey;
    this.#region = options.region;
    this.#from = options.from;
    this.#endpoint =
      options.endpoint ?? `https://email.${options.region}.amazonaws.com`;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async send(message: MailMessage): Promise<void> {
    const to = toAddresses(message.to);
    const content: Record<string, unknown> = {
      Simple: {
        Subject: { Data: message.subject },
        Body: {} as Record<string, unknown>,
      },
    };
    const body = (content.Simple as { Body: Record<string, unknown> }).Body;
    if (message.html) body.Html = { Data: message.html };
    if (message.text) body.Text = { Data: message.text };

    const destination: Record<string, unknown> = { ToAddresses: to };
    if (message.cc) destination.CcAddresses = toAddresses(message.cc);
    if (message.bcc) destination.BccAddresses = toAddresses(message.bcc);

    const payload = JSON.stringify({
      FromEmailAddress: message.from ?? this.#from,
      Destination: destination,
      ReplyToAddresses: message.replyTo
        ? toAddresses(message.replyTo)
        : undefined,
      Content: content,
    });

    const host = new URL(this.#endpoint).host;
    const { amz, date } = amzDate(this.#now());
    const service = "ses";
    const canonicalHeaders =
      `content-type:application/json\n` +
      `host:${host}\n` +
      `x-amz-date:${amz}\n`;
    const signedHeaders = "content-type;host;x-amz-date";
    const payloadHash = await sha256Hex(payload);
    const canonicalRequest = [
      "POST",
      "/v2/email/outbound-emails",
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const credentialScope = `${date}/${this.#region}/${service}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amz,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join("\n");

    const kDate = await hmac(`AWS4${this.#secretAccessKey}`, date);
    const kRegion = await hmac(kDate, this.#region);
    const kService = await hmac(kRegion, service);
    const kSigning = await hmac(kService, "aws4_request");
    const signature = bufferToHex(await hmac(kSigning, stringToSign));

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.#accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await this.#fetch(
      `${this.#endpoint}/v2/email/outbound-emails`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Host: host,
          "X-Amz-Date": amz,
          Authorization: authorization,
        },
        body: payload,
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SES API ${res.status}: ${text}`);
    }
  }
}
