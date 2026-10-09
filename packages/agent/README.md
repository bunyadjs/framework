# @bunyad/agent

Fast, zero-dependency user-agent parsing for Bunyad: browser, platform (OS), device and bot detection, with Client Hints support and the familiar `jenssegers/agent` API from Laravel.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add @bunyad/agent@beta
# or: npm install @bunyad/agent@beta
```

## Usage

```ts
import { Agent, agent } from "@bunyad/agent";

// In a controller or middleware
const a = agent(request);

a.browser(); // "Chrome"
a.version("Chrome"); // "124.0.6367.60"
a.platform(); // "Windows" | "macOS" | "iOS" | "iPadOS" | "Android" | "ChromeOS" | "Linux" | false
a.version(a.platform() as string); // "10" (or "11" via Client Hints)
a.version("Safari", Agent.VERSION_TYPE_FLOAT); // 17.4
a.version("Windows NT"); // "10.0"
a.device(); // "iPhone" | "iPad" | "Macintosh" | "Pixel" | "Samsung" | ... | false
a.isMobile(); // phone OR tablet (jenssegers semantics)
a.isPhone();
a.isTablet();
a.isDesktop();
a.isRobot();
a.isChrome();
a.isFirefox();
a.isSafari();
a.isEdge();
a.isOpera();
a.isAndroidOS();
a.isiOS();
a.isWindows();
a.isMacOS();
a.robot(); // "Googlebot" | "curl" | ... | false
a.deviceType(); // "desktop" | "phone" | "tablet" | "robot" | "other"
a.languages(); // ["en-us", "en"] from Accept-Language
a.is("iPhone"); // browser, platform, device or robot name; also "OS X", "AndroidOS", "Webkit"
a.match("Chrome/1\\d\\d");
a.toArray(); // plain snapshot for session device lists and audit logs
```

Standalone:

```ts
import { Agent, parseUserAgent } from "@bunyad/agent";

new Agent(userAgentString).browser();
new Agent(ua, {
  "sec-ch-ua": '"Microsoft Edge";v="124"',
  "sec-ch-ua-platform": '"Windows"',
}).browser(); // "Edge"
parseUserAgent(ua); // frozen, LRU-cached result
```

## Client Hints

When `Sec-CH-UA`, `Sec-CH-UA-Mobile`, `Sec-CH-UA-Platform` or `Sec-CH-UA-Platform-Version` are sent they win over the User-Agent string. That is the only way to see Brave and Windows 11. Hints are ignored entirely for detected bots.

## Performance

Precompiled, ordered regex tables (first match wins), one bot pre-check, and an LRU cache keyed by the UA string (`setAgentCacheSize(n)`, default 1000; `clearAgentCache()`). Run `bun run bench` in this package. Typical (Apple Silicon): ~20 ns cached, ~1.5–2 µs uncached.

## Differences from jenssegers/agent

| jenssegers/agent                                                    | @bunyad/agent                                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Magic `isChrome()`, `isAndroidOS()`, any `isXxx()` via `__call`     | Explicit helpers only: `isChrome`, `isFirefox`, `isSafari`, `isEdge`, `isOpera`, `isAndroidOS`, `isiOS`, `isWindows`, `isMacOS` (no Proxy on the hot path). Anything else: `is(name)`                                              |
| `is(name)` runs the Mobile_Detect rule for that name against the UA | `is(name)` compares against the detected browser / platform / device / robot (case-insensitive). Aliases: `OS X`→macOS, `AndroidOS`→Android, `iOS` also matches iPadOS, `Webkit`→AppleWebKit engine, `Internet Explorer`/`MSIE`→IE |
| Platform names `OS X`, `AndroidOS`, `Windows`, `iOS`                | Canonical names `macOS`, `Android`, `Windows`, `iOS`, `iPadOS`, `ChromeOS`, `Linux` (old names accepted by `is()`)                                                                                                                 |
| `version('Windows')` → NT version (`10.0`)                          | `version('Windows')` → marketing version (`10`, `11` with hints); `version('Windows NT')` → `10.0`                                                                                                                                 |
| `version(name, VERSION_TYPE_FLOAT)`                                 | Same: `Agent.VERSION_TYPE_FLOAT` / `"float"`                                                                                                                                                                                       |
| `deviceType()` desktop/phone/tablet/robot/other                     | Same vocabulary                                                                                                                                                                                                                    |
| `device()` from Mobile_Detect's large model list                    | Small list: iPhone, iPad, iPod, Kindle, Pixel, Samsung, Huawei, Xiaomi, Macintosh                                                                                                                                                  |
| No Client Hints                                                     | Client Hints preferred when present                                                                                                                                                                                                |
| `getRules()` returns Mobile_Detect regex maps                       | `Agent.getRules()` returns the ordered `[name, RegExp]` tables                                                                                                                                                                     |
| No cache                                                            | LRU cache keyed by UA string                                                                                                                                                                                                       |

## Limits

No device-model database, no remote downloads. Brave without Client Hints looks like Chrome; iPadOS in desktop mode looks like macOS. `Request` has no macros, so use `agent(request)` instead of `request.agent()`.
