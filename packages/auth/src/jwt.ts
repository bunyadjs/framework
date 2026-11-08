import { createHmac, timingSafeEqual } from "node:crypto";

export type JwtAlgorithm = "HS256";

function base64Url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function parsePart(part: string): Buffer {
  return Buffer.from(part, "base64url");
}

function headerJson(alg: JwtAlgorithm): string {
  return JSON.stringify({ alg, typ: "JWT" });
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

function claim(payload: Record<string, unknown>, name: string): number | undefined {
  const value = payload[name];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid JWT ${name} claim.`);
  }
  return value;
}

/**
 * HS256 JWT encode / decode.
 */
export const Jwt = {
  encode(
    payload: Record<string, unknown>,
    key: string,
    alg: JwtAlgorithm = "HS256",
  ): string {
    if (alg !== "HS256") {
      throw new Error(`Unsupported JWT algorithm [${alg}].`);
    }
    const header = base64Url(headerJson(alg));
    const body = base64Url(JSON.stringify(payload));
    const signingInput = `${header}.${body}`;
    return `${signingInput}.${signHs256(signingInput, key)}`;
  },

  decode<T = Record<string, unknown>>(jwt: string, key: string): T {
    const parts = jwt.split(".");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error("Invalid JWT.");
    }
    const [headerPart, bodyPart, signature] = parts;
    let header: { alg?: string };
    try {
      header = JSON.parse(parsePart(headerPart).toString("utf8")) as {
        alg?: string;
      };
    } catch {
      throw new Error("Invalid JWT header.");
    }
    if (header.alg !== "HS256") {
      throw new Error(`Unsupported JWT algorithm [${header.alg ?? ""}].`);
    }
    const signingInput = `${headerPart}.${bodyPart}`;
    const expected = signHs256(signingInput, key);
    if (!equal(signature, expected)) {
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
    const now = Math.floor(Date.now() / 1000);
    // A claim that is present but not a number would otherwise be skipped, and the token never expire.
    const exp = claim(payload, "exp");
    if (exp !== undefined && exp <= now) {
      throw new Error("Expired JWT.");
    }
    const nbf = claim(payload, "nbf");
    if (nbf !== undefined && nbf > now) {
      throw new Error("JWT is not valid yet.");
    }
    return payload as T;
  },
};
