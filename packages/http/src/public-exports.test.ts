import { expect, test } from "bun:test";
import * as http from "./index.ts";

test("helpers that only the package itself uses are not part of its public surface", () => {
  const names = Object.keys(http);
  for (const internal of [
    "withHeaders",
    "parseCacheHeaderOptions",
    "detectFileType",
    "isSafeSvg",
    "compileTrustedProxies",
    "clientFromForwardedFor",
    "parseIp",
  ]) {
    expect(names).not.toContain(internal);
  }
});

test("the standard names stay public", () => {
  for (const name of ["cacheHeaders", "throttle", "RateLimiter", "Limit", "setTrustedProxies", "handleCors"]) {
    expect(Object.keys(http)).toContain(name);
  }
});
