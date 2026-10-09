/** Node run: node --experimental-transform-types --test src/agent.node-test.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, agent, parseUserAgent } from "./index.ts";
import { FIXTURES } from "./fixtures.ts";

for (const [label, [ua, browser, bv, platform, pv, device, type, robot]] of Object.entries(FIXTURES)) {
  test(label, () => {
    const a = new Agent(ua);
    assert.equal(a.browser(), browser);
    if (browser !== false) assert.equal(a.version(browser), bv);
    assert.equal(a.platform(), platform);
    if (platform !== false) assert.equal(a.version(platform), pv);
    assert.equal(a.device(), device);
    assert.equal(a.deviceType(), type);
    assert.equal(a.robot(), robot);
    assert.equal(a.isMobile(), type === "phone" || type === "tablet");
  });
}

test("client hints + agent(request) on Node", () => {
  const headers = new Headers({ "user-agent": FIXTURES["Chrome / Windows 10"]![0], "sec-ch-ua": '"Microsoft Edge";v="124"', "sec-ch-ua-platform-version": '"15.0.0"', "sec-ch-ua-platform": '"Windows"' });
  const a = agent({ header: (n: string) => headers.get(n) });
  assert.equal(a.browser(), "Edge");
  assert.equal(a.version("Windows"), "11");
  assert.equal(parseUserAgent("curl/8.4.0"), parseUserAgent("curl/8.4.0"));
});
