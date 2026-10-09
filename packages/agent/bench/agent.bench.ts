/** bun packages/agent/bench/agent.bench.ts */
import { Agent, clearAgentCache, parseUserAgent, setAgentCacheSize } from "../src/index.ts";
import { FIXTURES } from "../src/fixtures.ts";

const uas = Object.values(FIXTURES).map((f) => f[0]);
const N = 200_000;

function bench(label: string, fn: (i: number) => unknown): void {
  for (let i = 0; i < 20_000; i++) fn(i); // warm up
  const start = Bun.nanoseconds();
  for (let i = 0; i < N; i++) fn(i);
  const ns = (Bun.nanoseconds() - start) / N;
  console.log(`${label.padEnd(44)} ${ns.toFixed(0).padStart(6)} ns/op`);
}

setAgentCacheSize(1000);
bench("parseUserAgent (cached)", (i) => parseUserAgent(uas[i % uas.length]));
bench("new Agent + browser/platform/isMobile (cached)", (i) => {
  const a = new Agent(uas[i % uas.length]);
  return a.browser() && a.platform() && a.isMobile();
});
const hints = { "sec-ch-ua": '"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"', "sec-ch-ua-mobile": "?0", "sec-ch-ua-platform": '"Windows"' };
bench("Agent with Client Hints (cached UA)", (i) => new Agent(uas[i % uas.length], hints).browser());

setAgentCacheSize(0);
bench("parseUserAgent (uncached, mixed fixtures)", (i) => parseUserAgent(uas[i % uas.length]));
bench("parseUserAgent (uncached, Chrome desktop)", () => parseUserAgent(uas[0]));
setAgentCacheSize(1000);
clearAgentCache();
