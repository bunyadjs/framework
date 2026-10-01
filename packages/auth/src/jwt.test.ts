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
