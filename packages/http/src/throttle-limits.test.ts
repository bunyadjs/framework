import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Limit, RateLimiter, Request, throttle } from "./index.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function from(ip: string): Request {
  const request = new Request(new globalThis.Request("http://localhost/login"));
  request.setRemoteAddress(ip);
  return request;
}

afterEach(() => setSystemTime());

describe("a named limiter that returns several limits", () => {
  function limited() {
    const limiter = new RateLimiter();
    limiter.for("login", (request: Request) => [
      Limit.perMinute(2).by(`ip:${request.ip()}`),
      Limit.perMinute(3).by("everyone"),
    ]);
    return { limiter, mw: throttle("login", 1, { limiter }) };
  }

  test("every limit is applied, not just the first", async () => {
    const { mw } = limited();
    let reached = 0;
    const next = async () => {
      reached += 1;
      return json({ ok: true });
    };
    // Three different clients, one request each: none is over its own limit of 2, but the shared limit is 3.
    expect((await mw.handle(from("10.0.0.1"), next)).status).toBe(200);
    expect((await mw.handle(from("10.0.0.2"), next)).status).toBe(200);
    expect((await mw.handle(from("10.0.0.3"), next)).status).toBe(200);
    const blocked = await mw.handle(from("10.0.0.4"), next);
    expect(blocked.status).toBe(429);
    expect(reached).toBe(3);
  });

  test("the first limit still works on its own", async () => {
    const { mw } = limited();
    const next = async () => json({ ok: true });
    expect((await mw.handle(from("10.0.0.1"), next)).status).toBe(200);
    expect((await mw.handle(from("10.0.0.1"), next)).status).toBe(200);
    expect((await mw.handle(from("10.0.0.1"), next)).status).toBe(429);
  });

  test("the handler runs once per request, whatever the number of limits", async () => {
    const { mw } = limited();
    let calls = 0;
    await mw.handle(from("10.0.0.9"), async () => {
      calls += 1;
      return json({ ok: true });
    });
    expect(calls).toBe(1);
  });

  test("the response reports the tightest limit", async () => {
    const { mw } = limited();
    const response = await mw.handle(from("10.0.0.1"), async () =>
      json({ ok: true }),
    );
    // 2 per client and 3 shared: after one request the client has 1 left, the shared limit has 2.
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("1");
    expect(response.headers.get("X-RateLimit-Limit")).toBe("2");
  });

  test("an unlimited entry in the list is skipped", async () => {
    const limiter = new RateLimiter();
    limiter.for("mixed", () => [Limit.none(), Limit.perMinute(1).by("k")]);
    const mw = throttle("mixed", 1, { limiter });
    expect(
      (await mw.handle(from("10.0.0.1"), async () => json({}))).status,
    ).toBe(200);
    expect(
      (await mw.handle(from("10.0.0.1"), async () => json({}))).status,
    ).toBe(429);
  });

  test("a custom blocked response is used", async () => {
    const limiter = new RateLimiter();
    limiter.for("custom", () =>
      Limit.perMinute(1)
        .by("k")
        .response(() => json({ message: "slow down" }, 429)),
    );
    const mw = throttle("custom", 1, { limiter });
    await mw.handle(from("10.0.0.1"), async () => json({}));
    const blocked = await mw.handle(from("10.0.0.1"), async () => json({}));
    expect(await blocked.json()).toEqual({ message: "slow down" });
  });
});

describe("rate headers", () => {
  const limiter = new RateLimiter();
  limiter.for("h", () => Limit.perMinute(5).by("k"));
  const mw = throttle("h", 1, { limiter });

  test("are added to the handler's own response, which is not copied", async () => {
    const own = json({ ok: true });
    const response = await mw.handle(from("10.0.0.1"), async () => own);
    expect(response).toBe(own);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
  });

  test("are added to a response that cannot be changed, by copying it", async () => {
    const response = await mw.handle(from("10.0.0.1"), async () =>
      Response.redirect("https://example.test/next", 302),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("5");
  });

  test("the body of the handler's response is untouched", async () => {
    const response = await mw.handle(from("10.0.0.1"), async () =>
      json({ hello: "world" }),
    );
    expect(await response.json()).toEqual({ hello: "world" });
  });
});

describe("limit keys", () => {
  test("by() sets the key", () => {
    expect(Limit.perMinute(5).by("single").key).toBe("single");
    expect(Limit.perMinute(5).by(42).key).toBe("42");
  });
});

describe("process-local counters", () => {
  test("counting is by key, and a blocked attempt is counted without moving the window", () => {
    const limiter = new RateLimiter();
    const results = Array.from(
      { length: 4 },
      () => limiter.attempt("k", 3, 60) as { allowed: boolean },
    );
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(limiter.attempts("k")).toBe(4);
    expect(limiter.attempts("other")).toBe(0);
  });

  test("a key whose window has ended counts as new", () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const limiter = new RateLimiter();
    for (let i = 0; i < 5; i += 1) limiter.attempt("blocked-client", 5, 60);
    expect(
      (limiter.attempt("blocked-client", 5, 60) as { allowed: boolean })
        .allowed,
    ).toBe(false);
    setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(limiter.attempts("blocked-client")).toBe(0);
    expect(
      (limiter.attempt("blocked-client", 5, 60) as { allowed: boolean })
        .allowed,
    ).toBe(true);
  });

  test("keys that are never asked for again are swept out as new ones arrive", () => {
    setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const limiter = new RateLimiter();
    for (let i = 0; i < 3_000; i += 1) limiter.attempt(`ip:${i}`, 5, 1);
    setSystemTime(new Date("2026-01-01T01:00:00Z"));
    for (let i = 0; i < 3_000; i += 1) limiter.attempt(`later:${i}`, 5, 1);
    // an old key is simply new again
    expect(limiter.attempts("ip:0")).toBe(0);
  });

  test("flush forgets everything", () => {
    const limiter = new RateLimiter();
    limiter.attempt("a", 5, 60);
    limiter.flush();
    expect(limiter.attempts("a")).toBe(0);
  });
});
