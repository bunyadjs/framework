import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Jwt } from "./index.ts";

const KEY = "k".repeat(32);
const now = () => Math.floor(Date.now() / 1000);

/** A token signed with `key` and a hand-written header and payload. */
function forge(header: object, payload: object, key = KEY): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${part(header)}.${part(payload)}`;
  return `${input}.${createHmac("sha256", key).update(input).digest("base64url")}`;
}

describe("the existing behaviour", () => {
  test("a token round-trips and a changed one is refused", () => {
    const token = Jwt.encode({ sub: "1", exp: now() + 60 }, KEY);
    expect(Jwt.decode<{ sub: string }>(token, KEY).sub).toBe("1");
    expect(() => Jwt.decode(token + "x", KEY)).toThrow("Invalid JWT signature");
    expect(() => Jwt.decode(token, "z".repeat(32))).toThrow("Invalid JWT signature");
  });

  test("an expired token is refused", () => {
    expect(() => Jwt.decode(Jwt.encode({ exp: now() - 5 }, KEY), KEY)).toThrow("Expired JWT");
  });

  test("another algorithm is refused", () => {
    expect(() => Jwt.decode(forge({ alg: "none", typ: "JWT" }, { sub: "1" }), KEY)).toThrow("Unsupported JWT algorithm");
  });
});

describe("claims", () => {
  test("a token that is not valid yet is refused", () => {
    const token = Jwt.encode({ nbf: now() + 3600, exp: now() + 7200 }, KEY);
    expect(() => Jwt.decode(token, KEY)).toThrow("not valid yet");
  });

  test("the token is accepted once its time has come, and leeway allows for clocks that differ", () => {
    expect(Jwt.decode(Jwt.encode({ nbf: now() - 1 }, KEY), KEY)).toBeDefined();
    const soon = Jwt.encode({ nbf: now() + 20 }, KEY);
    expect(() => Jwt.decode(soon, KEY)).toThrow("not valid yet");
    expect(Jwt.decode(soon, KEY, { leeway: 30 })).toBeDefined();
    const justExpired = Jwt.encode({ exp: now() - 10 }, KEY);
    expect(() => Jwt.decode(justExpired, KEY)).toThrow("Expired JWT");
    expect(Jwt.decode(justExpired, KEY, { leeway: 30 })).toBeDefined();
  });

  test("the issuer must match when one is asked for", () => {
    const token = Jwt.encode({ iss: "https://auth.example", exp: now() + 60 }, KEY);
    expect(Jwt.decode(token, KEY, { issuer: "https://auth.example" })).toBeDefined();
    expect(Jwt.decode(token, KEY, { issuer: ["https://other.example", "https://auth.example"] })).toBeDefined();
    expect(() => Jwt.decode(token, KEY, { issuer: "https://evil.example" })).toThrow("issuer");
    expect(() => Jwt.decode(Jwt.encode({ exp: now() + 60 }, KEY), KEY, { issuer: "https://auth.example" })).toThrow("issuer");
  });

  test("the audience must match when one is asked for, whether the token has one or several", () => {
    const one = Jwt.encode({ aud: "shop-api", exp: now() + 60 }, KEY);
    const many = Jwt.encode({ aud: ["shop-api", "reports"], exp: now() + 60 }, KEY);
    expect(Jwt.decode(one, KEY, { audience: "shop-api" })).toBeDefined();
    expect(Jwt.decode(many, KEY, { audience: "reports" })).toBeDefined();
    expect(Jwt.decode(many, KEY, { audience: ["nope", "shop-api"] })).toBeDefined();
    expect(() => Jwt.decode(one, KEY, { audience: "reports" })).toThrow("audience");
    expect(() => Jwt.decode(Jwt.encode({ exp: now() + 60 }, KEY), KEY, { audience: "shop-api" })).toThrow("audience");
  });

  test("an expiry can be required", () => {
    const noExpiry = Jwt.encode({ sub: "1" }, KEY);
    expect(Jwt.decode(noExpiry, KEY)).toBeDefined();
    expect(() => Jwt.decode(noExpiry, KEY, { requireExpiry: true })).toThrow("no expiry");
  });

  test("claims that are not numbers are refused, not ignored", () => {
    expect(() => Jwt.decode(Jwt.encode({ exp: "tomorrow" }, KEY), KEY)).toThrow("exp");
    expect(() => Jwt.decode(Jwt.encode({ nbf: "soon" }, KEY), KEY)).toThrow("nbf");
  });

  test("a check of your own can refuse a token, with a reason", () => {
    const token = Jwt.encode({ tv: 1, exp: now() + 60 }, KEY);
    expect(Jwt.decode(token, KEY, { validate: (p) => p.tv === 1 })).toBeDefined();
    expect(() => Jwt.decode(token, KEY, { validate: (p) => p.tv === 2 })).toThrow("Invalid JWT claims");
    expect(() => Jwt.decode(token, KEY, { validate: () => "session ended" })).toThrow("session ended");
    expect(Jwt.decode(token, KEY, { validate: () => undefined })).toBeDefined();
  });

  test("a token that is far too long is refused before it is parsed", () => {
    const huge = Jwt.encode({ blob: "x".repeat(40_000) }, KEY);
    expect(() => Jwt.decode(huge, KEY)).toThrow("too long");
    expect(Jwt.decode(huge, KEY, { maxLength: 100_000 })).toBeDefined();
  });
});

describe("rotating the key", () => {
  const OLD = "o".repeat(32);
  const NEW = "n".repeat(32);

  test("tokens signed with the previous key are accepted while it is listed", () => {
    const issuedBefore = Jwt.encode({ sub: "1", exp: now() + 60 }, OLD);
    const issuedAfter = Jwt.encode({ sub: "2", exp: now() + 60 }, NEW);
    const keys = [NEW, OLD];
    expect(Jwt.decode<{ sub: string }>(issuedBefore, keys).sub).toBe("1");
    expect(Jwt.decode<{ sub: string }>(issuedAfter, keys).sub).toBe("2");
    // once the old key is dropped, its tokens stop working
    expect(() => Jwt.decode(issuedBefore, [NEW])).toThrow("Invalid JWT signature");
  });

  test("a token signed with an unknown key is refused", () => {
    expect(() => Jwt.decode(Jwt.encode({ exp: now() + 60 }, "u".repeat(32)), [NEW, OLD])).toThrow("Invalid JWT signature");
  });

  test("key ids pick the key by the token's own header", () => {
    const keys = { byKeyId: { v1: OLD, v2: NEW } };
    const a = Jwt.encode({ sub: "a", exp: now() + 60 }, OLD, "HS256", { keyId: "v1" });
    const b = Jwt.encode({ sub: "b", exp: now() + 60 }, NEW, "HS256", { keyId: "v2" });
    expect(Jwt.decode<{ sub: string }>(a, keys).sub).toBe("a");
    expect(Jwt.decode<{ sub: string }>(b, keys).sub).toBe("b");
    expect(JSON.parse(Buffer.from(b.split(".")[0]!, "base64url").toString()).kid).toBe("v2");
  });

  test("an unknown or missing key id is refused when keys are named", () => {
    const keys = { byKeyId: { v1: OLD } };
    expect(() => Jwt.decode(Jwt.encode({}, OLD, "HS256", { keyId: "v9" }), keys)).toThrow("key");
    expect(() => Jwt.decode(Jwt.encode({}, OLD), keys)).toThrow("key");
  });

  test("a token cannot name a key it was not signed with", () => {
    const keys = { byKeyId: { v1: OLD, v2: NEW } };
    const lying = Jwt.encode({ exp: now() + 60 }, OLD, "HS256", { keyId: "v2" });
    expect(() => Jwt.decode(lying, keys)).toThrow("Invalid JWT signature");
  });

  test("an empty list of keys refuses everything", () => {
    expect(() => Jwt.decode(Jwt.encode({}, KEY), [])).toThrow();
  });
});

describe("Jwt.sign", () => {
  test("sets the times and claims, and understands durations such as 7d", () => {
    const token = Jwt.sign({ sub: "1" }, KEY, { expiresIn: "7d", issuer: "me", audience: "you", notBefore: 0 });
    const payload = Jwt.decode<Record<string, number | string>>(token, KEY);
    expect(payload.sub).toBe("1");
    expect(payload.iss).toBe("me");
    expect(payload.aud).toBe("you");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(7 * 86_400);
    expect(payload.nbf).toBe(payload.iat);
  });

  test("durations", () => {
    const seconds = (expiresIn: string | number) => {
      const p = Jwt.decode<{ iat: number; exp: number }>(Jwt.sign({}, KEY, { expiresIn }), KEY);
      return p.exp - p.iat;
    };
    expect(seconds(90)).toBe(90);
    expect(seconds("90")).toBe(90);
    expect(seconds("15m")).toBe(900);
    expect(seconds("2h")).toBe(7200);
    expect(seconds("1d")).toBe(86_400);
    expect(seconds("1w")).toBe(7 * 86_400);
    expect(() => Jwt.sign({}, KEY, { expiresIn: "soon" })).toThrow("expiresIn");
  });

  test("a token with no expiry is only made on purpose", () => {
    expect(() => Jwt.sign({}, KEY, {} as never)).toThrow("expiresIn");
    expect(Jwt.decode(Jwt.sign({}, KEY, { expiresIn: null }), KEY)).toBeDefined();
  });

  test("the payload's own claims are not overwritten by the defaults it did not ask for", () => {
    const token = Jwt.sign({ sub: "1", tv: 3 }, KEY, { expiresIn: 60 });
    expect(Jwt.decode<{ tv: number }>(token, KEY).tv).toBe(3);
  });

  test("a key id goes in the header", () => {
    const token = Jwt.sign({}, KEY, { expiresIn: 60, keyId: "v2" });
    expect(JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).kid).toBe("v2");
  });
});

describe("speed", () => {
  test("decoding with claim checks costs about the same as before", () => {
    const token = Jwt.sign({ sub: "1", tv: 1 }, KEY, { expiresIn: 60 });
    for (let i = 0; i < 3_000; i += 1) Jwt.decode(token, KEY);
    const started = performance.now();
    for (let i = 0; i < 30_000; i += 1) Jwt.decode(token, KEY, { leeway: 5 });
    expect((performance.now() - started) / 30_000).toBeLessThan(0.05); // under 50 µs
  });
});
