import { afterEach, expect, test } from "bun:test";
import { Request, setTrustedProxies } from "./index.ts";

function through(peer: string, headers: Record<string, string>): Request {
  const request = new Request(new globalThis.Request("http://localhost/", { headers }));
  request.setRemoteAddress(peer);
  return request;
}

afterEach(() => setTrustedProxies([]));

test("a client cannot choose its address by putting entries on the left of X-Forwarded-For", () => {
  setTrustedProxies(["10.0.0.1"]);
  // The proxy appends the address it saw; everything to the left is whatever the client sent.
  const request = through("10.0.0.1", { "x-forwarded-for": "6.6.6.6, 203.0.113.5" });
  expect(request.ip()).toBe("203.0.113.5");
});

test("a chain of trusted proxies is skipped from the right", () => {
  setTrustedProxies(["10.0.0.0/8"]);
  const request = through("10.0.0.1", {
    "x-forwarded-for": "6.6.6.6, 203.0.113.5, 10.1.2.3, 10.4.5.6",
  });
  expect(request.ip()).toBe("203.0.113.5");
});

test("when every entry is a trusted proxy the left-most one is used", () => {
  setTrustedProxies("*");
  const request = through("192.0.2.1", { "x-forwarded-for": "203.0.113.9" });
  expect(request.ip()).toBe("203.0.113.9");
  const chained = through("192.0.2.1", { "x-forwarded-for": "203.0.113.9, 198.51.100.2" });
  expect(chained.ip()).toBe("203.0.113.9");
});

test("headers are ignored when the connection is not from a trusted proxy", () => {
  setTrustedProxies(["10.0.0.1"]);
  const request = through("203.0.113.50", { "x-forwarded-for": "1.2.3.4" });
  expect(request.ip()).toBe("203.0.113.50");
});

test("IPv6 peers and ranges are matched", () => {
  setTrustedProxies(["::1", "fd00::/8", "2001:db8:1::/48"]);
  expect(through("::1", { "x-forwarded-for": "203.0.113.7" }).ip()).toBe("203.0.113.7");
  expect(through("fd12:3456::9", { "x-forwarded-for": "203.0.113.8" }).ip()).toBe("203.0.113.8");
  expect(through("2001:db8:1:5::2", { "x-forwarded-for": "203.0.113.9" }).ip()).toBe("203.0.113.9");
  // Outside the ranges: headers ignored.
  expect(through("2001:db8:2::2", { "x-forwarded-for": "1.2.3.4" }).ip()).toBe("2001:db8:2::2");
  expect(through("fe80::1", { "x-forwarded-for": "1.2.3.4" }).ip()).toBe("fe80::1");
});

test("an IPv4 address written as IPv6 is treated as IPv4", () => {
  setTrustedProxies(["10.0.0.0/8"]);
  const request = through("::ffff:10.0.0.7", { "x-forwarded-for": "203.0.113.5" });
  expect(request.ip()).toBe("203.0.113.5");
});

test("IPv6 client addresses in the chain are returned as written", () => {
  setTrustedProxies(["10.0.0.1"]);
  const request = through("10.0.0.1", { "x-forwarded-for": "2001:db8::77, 10.0.0.1" });
  expect(request.ip()).toBe("2001:db8::77");
});

test("prefix and CIDR forms, and exact addresses, all still work", () => {
  setTrustedProxies(["10.0.0.", "172.16.0.0/12", "192.0.2.9"]);
  expect(through("10.0.0.77", { "x-forwarded-for": "203.0.113.1" }).ip()).toBe("203.0.113.1");
  expect(through("172.31.255.255", { "x-forwarded-for": "203.0.113.2" }).ip()).toBe("203.0.113.2");
  expect(through("172.32.0.1", { "x-forwarded-for": "203.0.113.3" }).ip()).toBe("172.32.0.1");
  expect(through("192.0.2.9", { "x-forwarded-for": "203.0.113.4" }).ip()).toBe("203.0.113.4");
});

test("a malformed or oversized header cannot be used to pick an address", () => {
  setTrustedProxies(["10.0.0.1"]);
  const junk = through("10.0.0.1", { "x-forwarded-for": "not-an-ip, 203.0.113.5" });
  expect(junk.ip()).toBe("203.0.113.5");
  const onlyJunk = through("10.0.0.1", { "x-forwarded-for": "garbage" });
  expect(onlyJunk.ip()).toBe("10.0.0.1");
  const long = through("10.0.0.1", { "x-forwarded-for": `${"1".repeat(500)}, 203.0.113.5` });
  expect(long.ip()).toBe("203.0.113.5");
});

test("X-Real-IP is never believed", () => {
  setTrustedProxies(["10.0.0.1"]);
  expect(through("10.0.0.1", { "x-real-ip": "203.0.113.5" }).ip()).toBe("10.0.0.1");
  expect(
    through("10.0.0.1", { "x-forwarded-for": "203.0.113.6", "x-real-ip": "1.1.1.1" }).ip(),
  ).toBe("203.0.113.6");
});

test("one client is one address, however the proxy wrote it", () => {
  setTrustedProxies(["10.0.0.1"]);
  const ip = (forwarded: string) => through("10.0.0.1", { "x-forwarded-for": forwarded }).ip();
  // IPv4 written as IPv6, with a port, with leading zeros
  expect(ip("::ffff:203.0.113.5")).toBe("203.0.113.5");
  expect(ip("203.0.113.5:4433")).toBe("203.0.113.5");
  expect(ip("203.000.113.005")).toBe("203.0.113.5");
  // IPv6: case, leading zeros, compression, brackets with a port, zone
  const canonical = "2001:db8::1";
  expect(ip("2001:DB8::1")).toBe(canonical);
  expect(ip("2001:0db8:0:0:0:0:0:1")).toBe(canonical);
  expect(ip("2001:db8:0:0:0:0:0:0001")).toBe(canonical);
  expect(ip("[2001:db8::1]:8443")).toBe(canonical);
  expect(ip("2001:db8::1%eth0")).toBe(canonical);
  expect(ip("::1")).toBe("::1");
  expect(ip("2001:db8:0:1:0:0:0:1")).toBe("2001:db8:0:1::1");
});

test("ip() follows a change of trusted proxies and of the remote address", () => {
  const request = through("10.0.0.1", { "x-forwarded-for": "203.0.113.5" });
  expect(request.ip()).toBe("10.0.0.1");
  setTrustedProxies(["10.0.0.1"]);
  expect(request.ip()).toBe("203.0.113.5");
  request.setRemoteAddress("192.0.2.1");
  expect(request.ip()).toBe("192.0.2.1");
});

test("ips() returns the whole chain only behind a trusted proxy", () => {
  setTrustedProxies(["10.0.0.1"]);
  expect(through("10.0.0.1", { "x-forwarded-for": "6.6.6.6, 203.0.113.5" }).ips()).toEqual([
    "6.6.6.6",
    "203.0.113.5",
  ]);
  expect(through("203.0.113.50", { "x-forwarded-for": "6.6.6.6" }).ips()).toEqual(["203.0.113.50"]);
});

test("matching a trusted peer is cheap: many lookups on a large list", () => {
  const list = Array.from({ length: 200 }, (_, i) => `10.${i}.0.0/16`);
  setTrustedProxies(list);
  const request = through("10.199.4.4", { "x-forwarded-for": "203.0.113.5" });
  const start = performance.now();
  for (let i = 0; i < 20_000; i += 1) {
    // A fresh request each time, as in a real server.
    through("10.199.4.4", { "x-forwarded-for": "203.0.113.5" }).ip();
  }
  const elapsed = performance.now() - start;
  expect(request.ip()).toBe("203.0.113.5");
  // 20,000 requests against 200 ranges must stay well under a second.
  expect(elapsed).toBeLessThan(1000);
});
