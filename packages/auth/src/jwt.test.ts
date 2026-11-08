import { expect, test } from "bun:test";
import { Jwt } from "./jwt.ts";

test("Jwt.encode / decode round-trips a payload", () => {
  const token = Jwt.encode({ sub: "42", tenantId: "t1" }, "secret");
  expect(Jwt.decode<{ sub: string; tenantId: string }>(token, "secret")).toEqual({
    sub: "42",
    tenantId: "t1",
  });
});

test("Jwt.decode rejects a bad signature", () => {
  const token = Jwt.encode({ sub: "1" }, "secret");
  expect(() => Jwt.decode(token, "other")).toThrow("Invalid JWT signature.");
});

test("Jwt.decode rejects an expired token", () => {
  const token = Jwt.encode(
    { sub: "1", exp: Math.floor(Date.now() / 1000) - 10 },
    "secret",
  );
  expect(() => Jwt.decode(token, "secret")).toThrow("Expired JWT.");
});

const inSeconds = (offset: number) => Math.floor(Date.now() / 1000) + offset;

test("Jwt.decode accepts a token that has not expired", () => {
  const token = Jwt.encode({ sub: "1", exp: inSeconds(60) }, "secret");
  expect(Jwt.decode<{ sub: string }>(token, "secret").sub).toBe("1");
});

test("Jwt.decode refuses an expiry that is not a number, instead of ignoring it", () => {
  for (const exp of ["tomorrow", "9999999999", null, true, {}, [1]]) {
    const token = Jwt.encode({ sub: "1", exp }, "secret");
    expect(() => Jwt.decode(token, "secret")).toThrow("Invalid JWT exp claim.");
  }
});

test("Jwt.decode refuses a token that is not valid yet (nbf)", () => {
  const token = Jwt.encode({ sub: "1", nbf: inSeconds(3600) }, "secret");
  expect(() => Jwt.decode(token, "secret")).toThrow("JWT is not valid yet.");
  expect(() =>
    Jwt.decode(Jwt.encode({ sub: "1", nbf: "soon" }, "secret"), "secret"),
  ).toThrow("Invalid JWT nbf claim.");
  expect(
    Jwt.decode<{ sub: string }>(Jwt.encode({ sub: "1", nbf: inSeconds(-5) }, "secret"), "secret").sub,
  ).toBe("1");
});
