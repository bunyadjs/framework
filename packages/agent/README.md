# @bunyad/agent

Fast, zero-dependency user-agent parsing for Bunyad: browser, platform (OS), device and bot detection, with Client Hints support and the familiar `jenssegers/agent` API from Laravel.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/agent@beta
# or: npm install @bunyad/agent@beta
```

## Usage

```ts
import { agent } from "@bunyad/agent";

// In a controller or middleware
const a = agent(request);

a.browser();            // "Chrome"
a.version("Chrome");    // "124.0.6367.60"
a.platform();           // "Windows" | "macOS" | "iOS" | "iPadOS" | "Android" | "ChromeOS" | "Linux" | false
a.version(a.platform() as string); // "10" (or "11" via Client Hints)
a.device();             // "iPhone" | "iPad" | "Macintosh" | "Pixel" | "Samsung" | ... | false
a.isMobile(); a.isTablet(); a.isDesktop(); a.isRobot();
a.robot();              // "Googlebot" | "curl" | ... | false
a.deviceType();         // "desktop" | "mobile" | "tablet" | "robot" | "unknown"
a.languages();          // ["en-us", "en"] from Accept-Language
a.is("iPhone");         // browser, platform, device or robot name
a.match("Chrome/1\\d\\d");
a.toArray();            // plain snapshot for session device lists and audit logs
```

Standalone:

```ts
import { Agent, parseUserAgent } from "@bunyad/agent";

new Agent(userAgentString).browser();
new Agent(ua, { "sec-ch-ua": '"Microsoft Edge";v="124"', "sec-ch-ua-platform": '"Windows"' }).browser(); // "Edge"
parseUserAgent(ua); // frozen, LRU-cached result
```

## Client Hints

When `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` or `Sec-CH-UA-Platform-Version` are sent they win over the User-Agent string. That is the only way to see Brave and Windows 11.

## Performance

Precompiled, ordered regex tables (first match wins), one bot pre-check, and an LRU cache keyed by the UA string (`setAgentCacheSize(n)`, default 1000; `clearAgentCache()`). Run `bun run bench` in this package. Typical (Apple Silicon): ~20 ns cached, ~1.5–2 µs uncached.

## Limits

No device-model database, no remote downloads. Brave without Client Hints looks like Chrome; iPadOS in desktop mode looks like macOS. `Request` has no macros, so use `agent(request)` instead of `request.agent()`.
