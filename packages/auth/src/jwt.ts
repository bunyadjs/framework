import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtAlgorithm = "HS256";

function base64Url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function parsePart(part: string): Buffer {
  return Buffer.from(part, "base64url");
}

function headerJson(alg: JwtAlgorithm, keyId?: string): string {
  return JSON.stringify(keyId === undefined ? { alg, typ: "JWT" } : { alg, typ: "JWT", kid: keyId });
}

function signHs256(data: string, key: string): string {
  return createHmac("sha256", key).update(data).digest("base64url");
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * The key (or keys) a token may be signed with.
 * - a string: one key;
 * - a list, newest first: during a rotation, tokens signed with any listed key are accepted;
 * - `{ byKeyId }`: the key is chosen by the token's own `kid` header, and a token with no `kid`
 *   or an unknown one is refused.
 */
export type JwtKeys = string | readonly string[] | { byKeyId: Readonly<Record<string, string>> };

export type JwtVerifyOptions = {
  /** Accepted `iss` values. A token with a different issuer, or none, is refused. */
  issuer?: string | readonly string[];
  /** Accepted `aud` values. A token that names none of them is refused. */
  audience?: string | readonly string[];
  /** Seconds of clock difference to allow on `exp` and `nbf`. Default 0. */
  leeway?: number;
  /** Refuse a token that has no `exp`. Default false. */
  requireExpiry?: boolean;
  /** Longest token accepted, in characters, checked before anything is parsed. Default 16,384. */
  maxLength?: number;
  /**
   * A check of your own on the claims. Return `false` (or text, used as the reason) to refuse the
   * token. For a check that needs the database (a user's current token version) use the payload
   * after decoding instead.
   */
  validate?: (payload: Record<string, unknown>) => boolean | string | void;
  /** The time to judge by, in seconds. Default: now. */
  now?: number;
};

export type JwtSignOptions = {
  /**
   * Lifetime in seconds, or text such as `15m`, `2h`, `7d`, `1w`. Required: pass `null` for a token
   * that never expires, so that is always a decision.
   */
  expiresIn: number | string | null;
  /** Seconds (or text) after issue before the token is valid; `0` means from the moment it is issued. */
  notBefore?: number | string;
  issuer?: string;
  audience?: string | readonly string[];
  subject?: string;
  /** Written in the header as `kid`, for key rotation with `{ byKeyId }`. */
  keyId?: string;
};

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400, w: 604_800 };

function seconds(value: number | string, name: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const match = /^(\d+)([smhdw])$/i.exec(text);
  if (!match) throw new Error(`Invalid ${name} [${text}].`);
  return Number(match[1]) * UNIT_SECONDS[match[2]!.toLowerCase()]!;
}

const DEFAULT_MAX_LENGTH = 16_384;

function candidateKeys(keys: JwtKeys, keyId: unknown): string[] {
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) {
    if (keys.length === 0) throw new Error("No JWT keys are configured.");
    return [...keys];
  }
  const named = (keys as { byKeyId: Readonly<Record<string, string>> }).byKeyId;
  const key = typeof keyId === "string" && Object.hasOwn(named, keyId) ? named[keyId] : undefined;
  if (key === undefined) throw new Error("Unknown JWT key.");
  return [key];
}

function list(value: string | readonly string[]): readonly string[] {
  return typeof value === "string" ? [value] : value;
}

/**
 * HS256 JWT encode / decode.
 */
export const Jwt = {
  encode(
    payload: Record<string, unknown>,
    key: string,
    alg: JwtAlgorithm = "HS256",
    options: { keyId?: string } = {},
  ): string {
    if (alg !== "HS256") {
      throw new Error(`Unsupported JWT algorithm [${alg}].`);
    }
    const header = base64Url(headerJson(alg, options.keyId));
    const body = base64Url(JSON.stringify(payload));
    const signingInput = `${header}.${body}`;
    return `${signingInput}.${signHs256(signingInput, key)}`;
  },

  /**
   * Make a token with `iat`, `exp` and the claims asked for. Your own payload keys are kept.
   * `Jwt.sign({ sub: user.id }, secret, { expiresIn: "7d" })`.
   */
  sign(
    payload: Record<string, unknown>,
    key: string,
    options: JwtSignOptions,
    alg: JwtAlgorithm = "HS256",
  ): string {
    if (!options || !("expiresIn" in options)) {
      throw new Error("Jwt.sign needs expiresIn (pass null for a token that never expires).");
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { ...payload, iat: issuedAt };
    if (options.expiresIn !== null) claims.exp = issuedAt + seconds(options.expiresIn, "expiresIn");
    if (options.notBefore !== undefined) claims.nbf = issuedAt + seconds(options.notBefore, "notBefore");
    if (options.issuer !== undefined) claims.iss = options.issuer;
    if (options.audience !== undefined) claims.aud = options.audience;
    if (options.subject !== undefined) claims.sub = options.subject;
    return Jwt.encode(claims, key, alg, { keyId: options.keyId });
  },

  decode<T = Record<string, unknown>>(jwt: string, keys: JwtKeys, options: JwtVerifyOptions = {}): T {
    if (jwt.length > (options.maxLength ?? DEFAULT_MAX_LENGTH)) {
      throw new Error("JWT is too long.");
    }
    const parts = jwt.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error("Invalid JWT.");
    }
    const [headerPart, bodyPart, signature] = parts;
    let header: { alg?: string; kid?: unknown };
    try {
      header = JSON.parse(parsePart(headerPart).toString("utf8")) as {
        alg?: string;
        kid?: unknown;
      };
    } catch {
      throw new Error("Invalid JWT header.");
    }
    if (header.alg !== "HS256") {
      throw new Error(`Unsupported JWT algorithm [${header.alg ?? ""}].`);
    }
    const signingInput = `${headerPart}.${bodyPart}`;
    // Every candidate is checked, so the time taken does not say which key (if any) matched.
    let valid = false;
    for (const key of candidateKeys(keys, header.kid)) {
      if (equal(signature, signHs256(signingInput, key))) valid = true;
    }
    if (!valid) {
      throw new Error("Invalid JWT signature.");
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(parsePart(bodyPart).toString("utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw new Error("Invalid JWT payload.");
    }
    checkClaims(payload, options);
    return payload as T;
  },
};

function numeric(payload: Record<string, unknown>, name: string): number | undefined {
  const value = payload[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid JWT ${name} claim.`);
  }
  return value;
}

function checkClaims(payload: Record<string, unknown>, options: JwtVerifyOptions): void {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const leeway = options.leeway ?? 0;

  const exp = numeric(payload, "exp");
  if (exp === undefined) {
    if (options.requireExpiry) throw new Error("JWT has no expiry.");
  } else if (exp + leeway <= now) {
    throw new Error("Expired JWT.");
  }
  const nbf = numeric(payload, "nbf");
  if (nbf !== undefined && nbf - leeway > now) {
    throw new Error("JWT is not valid yet.");
  }
  if (options.issuer !== undefined) {
    const issuer = payload.iss;
    if (typeof issuer !== "string" || !list(options.issuer).includes(issuer)) {
      throw new Error("Invalid JWT issuer.");
    }
  }
  if (options.audience !== undefined) {
    const named = typeof payload.aud === "string" ? [payload.aud] : Array.isArray(payload.aud) ? payload.aud : [];
    const wanted = list(options.audience);
    if (!named.some((audience) => typeof audience === "string" && wanted.includes(audience))) {
      throw new Error("Invalid JWT audience.");
    }
  }
  if (options.validate) {
    const verdict = options.validate(payload);
    if (verdict === false) throw new Error("Invalid JWT claims.");
    if (typeof verdict === "string") throw new Error(verdict);
  }
}
