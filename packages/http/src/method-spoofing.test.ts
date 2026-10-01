import { describe, expect, test } from "bun:test";
import { resolveRequestMethod } from "./method-spoofing.ts";

describe("resolveRequestMethod", () => {
  test("leaves non-POST alone", async () => {
    const raw = new Request("http://localhost/users/1", { method: "PUT" });
    expect(await resolveRequestMethod(raw)).toBe("PUT");
  });

  test("spoofs from _method in urlencoded body", async () => {
    const raw = new Request("http://localhost/users/1", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "_method=PUT&name=Ada",
    });
    expect(await resolveRequestMethod(raw)).toBe("PUT");
  });

  test("spoofs from JSON body", async () => {
    const raw = new Request("http://localhost/users/1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _method: "DELETE" }),
    });
    expect(await resolveRequestMethod(raw)).toBe("DELETE");
  });

  test("spoofs from header", async () => {
    const raw = new Request("http://localhost/users/1", {
      method: "POST",
      headers: { "X-HTTP-Method-Override": "PATCH" },
    });
    expect(await resolveRequestMethod(raw)).toBe("PATCH");
  });
});
