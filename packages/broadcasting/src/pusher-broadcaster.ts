import type { Broadcaster } from "./broadcaster.ts";

export type PusherBroadcasterOptions = {
  appId: string;
  key: string;
  secret: string;
  cluster?: string;
  /** Override host (Pusher Channels / Soketi / Laravel WebSockets). */
  host?: string;
  useTLS?: boolean;
  fetch?: typeof fetch;
};

/**
 * Thin Pusher Channels HTTP API adapter (`POST /apps/{id}/events`).
 */
export class PusherBroadcaster implements Broadcaster {
  readonly #appId: string;
  readonly #key: string;
  readonly #secret: string;
  readonly #host: string;
  readonly #scheme: string;
  readonly #fetch: typeof fetch;

  constructor(options: PusherBroadcasterOptions) {
    this.#appId = options.appId;
    this.#key = options.key;
    this.#secret = options.secret;
    this.#host =
      options.host ??
      `api-${options.cluster ?? "mt1"}.pusher.com`;
    this.#scheme = (options.useTLS ?? true) ? "https" : "http";
    this.#fetch = options.fetch ?? fetch;
  }

  async broadcast(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({
      name: event,
      channels,
      data: JSON.stringify(payload),
    });
    const path = `/apps/${this.#appId}/events`;
    const auth = await signPusherRequest({
      method: "POST",
      path,
      body,
      key: this.#key,
      secret: this.#secret,
    });

    const url = `${this.#scheme}://${this.#host}${path}?${auth}`;
    const res = await this.#fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!res.ok) {
      throw new Error(`Pusher broadcast failed: ${res.status} ${await res.text()}`);
    }
  }
}

/** @internal */
export async function signPusherRequest(input: {
  method: string;
  path: string;
  body: string;
  key: string;
  secret: string;
  timestamp?: number;
}): Promise<string> {
  const auth_timestamp = String(input.timestamp ?? Math.floor(Date.now() / 1000));
  const auth_version = "1.0";
  const body_md5 = await md5Hex(input.body);
  const query = new URLSearchParams({
    auth_key: input.key,
    auth_timestamp,
    auth_version,
    body_md5,
  });
  // Pusher signs sorted query string
  query.sort();
  const stringToSign = `${input.method}\n${input.path}\n${query.toString()}`;
  const auth_signature = await hmacSha256Hex(input.secret, stringToSign);
  query.set("auth_signature", auth_signature);
  return query.toString();
}

async function md5Hex(data: string): Promise<string> {
  const hash = new Bun.CryptoHasher("md5");
  hash.update(data);
  return hash.digest("hex");
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
