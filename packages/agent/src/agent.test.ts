import { beforeEach, describe, expect, test } from "bun:test";
import {
  Agent,
  agent,
  clearAgentCache,
  parseUserAgent,
  setAgentCacheSize,
} from "./index.ts";
import { FIXTURES } from "./fixtures.ts";

function ua(label: string): string {
  const fixture = FIXTURES[label];
  if (fixture === undefined) throw new Error(`missing fixture: ${label}`);
  return fixture[0];
}

const CHROME_WIN = ua("Chrome / Windows 10");

describe("fixtures", () => {
  for (const [
    label,
    [ua, browser, bv, platform, pv, device, type, robot],
  ] of Object.entries(FIXTURES)) {
    test(label, () => {
      const a = new Agent(ua);
      expect(a.browser()).toBe(browser);
      if (browser !== false) expect(a.version(browser)).toBe(bv);
      expect(a.platform()).toBe(platform);
      if (platform !== false) expect(a.version(platform)).toBe(pv);
      expect(a.device()).toBe(device);
      expect(a.deviceType()).toBe(type);
      expect(a.robot()).toBe(robot);
      expect(a.isRobot()).toBe(robot !== false);
      expect(a.isMobile()).toBe(type === "phone" || type === "tablet");
      expect(a.isPhone()).toBe(type === "phone");
      expect(a.isTablet()).toBe(type === "tablet");
      expect(a.isDesktop()).toBe(type === "desktop");
    });
  }
});

describe("lowercase generic bots", () => {
  test("still detected outside a mobile device comment", () => {
    for (const s of [
      "mybot/1.0 (+https://example.com/bot)",
      "Mozilla/5.0 (compatible; examplebot/2.1; +https://example.com)",
      "Mozilla/5.0 (Linux; Android 11; cubot note 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 fetchbot/1.0",
    ]) {
      expect(new Agent(s).isRobot()).toBe(true);
    }
  });
});

describe("hostile input", () => {
  test("empty and null", () => {
    for (const ua of ["", null, undefined]) {
      const a = new Agent(ua);
      expect(a.browser()).toBe(false);
      expect(a.platform()).toBe(false);
      expect(a.deviceType()).toBe("other");
      expect(a.isDesktop()).toBe(false);
      expect(a.isRobot()).toBe(false);
    }
  });

  test("very long UA is bounded", () => {
    const ua = CHROME_WIN + "a".repeat(10_000) + "x(".repeat(5000);
    const start = performance.now();
    expect(new Agent(ua).browser()).toBe("Chrome");
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("client hints", () => {
  test("Edge brand wins over UA", () => {
    const a = new Agent(CHROME_WIN, {
      "Sec-CH-UA":
        '"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Windows"',
    });
    expect(a.browser()).toBe("Edge");
    expect(a.version("Edge")).toBe("124");
    expect(a.isDesktop()).toBe(true);
  });

  test("Brave detected; GREASE ignored", () => {
    const a = new Agent(CHROME_WIN, {
      "sec-ch-ua": '"Not)A;Brand";v="99", "Brave";v="124", "Chromium";v="124"',
    });
    expect(a.browser()).toBe("Brave");
  });

  test("Google Chrome keeps full UA version when major matches", () => {
    const a = new Agent(CHROME_WIN, {
      "sec-ch-ua":
        '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    });
    expect(a.browser()).toBe("Chrome");
    expect(a.version("Chrome")).toBe("124.0.6367.60");
  });

  test("Windows 11 via platform version", () => {
    const a = new Agent(CHROME_WIN, {
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"15.0.0"',
    });
    expect(a.version("Windows")).toBe("11");
    const ten = new Agent(CHROME_WIN, {
      "sec-ch-ua-platform": '"Windows"',
      "sec-ch-ua-platform-version": '"10.0.0"',
    });
    expect(ten.version("Windows")).toBe("10");
  });

  test("mobile hint and platform hint", () => {
    const a = new Agent(
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
      {
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
      },
    );
    expect(a.isMobile()).toBe(true);
    expect(a.isPhone()).toBe(true);
    expect(a.platform()).toBe("Android");
  });

  test("bots ignore all hints, platform included", () => {
    const a = new Agent("curl/8.4.0", {
      "sec-ch-ua": '"Google Chrome";v="124"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Windows"',
    });
    expect(a.isRobot()).toBe(true);
    expect(a.browser()).toBe(false);
    expect(a.platform()).toBe(false);
    expect(a.deviceType()).toBe("robot");
  });
});

describe("api", () => {
  test("languages q-sorted", () => {
    const a = new Agent(CHROME_WIN, {
      "accept-language": "en-US;q=0.8, nl-NL, nl;q=0.9, en;q=0.7, *;q=0.1",
    });
    expect(a.languages()).toEqual(["nl-nl", "nl", "en-us", "en"]);
    expect(new Agent(CHROME_WIN).languages()).toEqual([]);
  });

  test("is() and match()", () => {
    const a = new Agent(ua("Safari / iPhone"));
    expect(a.is("iphone")).toBe(true);
    expect(a.is("iOS")).toBe(true);
    expect(a.is("Safari")).toBe(true);
    expect(a.is("Android")).toBe(false);
    expect(a.match("Mobile/\\w+")).toBe(true);
    expect(a.match(/android/i)).toBe(false);
  });

  test("version() for names not detected", () => {
    const a = new Agent(ua("Edge / Windows"));
    expect(a.version("Chrome")).toBe("124.0.0.0");
    expect(a.version("AppleWebKit")).toBe("537.36");
    expect(a.version("Nope")).toBe(false);
  });

  test("setUserAgent / getUserAgent / setHttpHeaders", () => {
    const a = new Agent(CHROME_WIN);
    expect(a.browser()).toBe("Chrome");
    a.setUserAgent("curl/8.4.0");
    expect(a.getUserAgent()).toBe("curl/8.4.0");
    expect(a.isRobot()).toBe(true);
    a.setHttpHeaders({ "User-Agent": ua("Safari / iPad") });
    expect(a.isTablet()).toBe(true);
  });

  test("agent(request) reads headers from a request-like object", () => {
    const headers = new Headers({
      "user-agent": CHROME_WIN,
      "sec-ch-ua": '"Microsoft Edge";v="124"',
      "accept-language": "ur-PK,en;q=0.5",
    });
    const request = { header: (name: string) => headers.get(name) };
    const a = agent(request);
    expect(a.browser()).toBe("Edge");
    expect(a.languages()).toEqual(["ur-pk", "en"]);
    expect(Agent.fromRequest(request).platform()).toBe("Windows");
  });

  test("toArray snapshot", () => {
    expect(new Agent(ua("Safari / iPad")).toArray()).toEqual({
      browser: "Safari",
      browserVersion: "17.4",
      platform: "iPadOS",
      platformVersion: "17.4",
      device: "iPad",
      deviceType: "tablet",
      robot: false,
      mobile: true,
      phone: false,
      tablet: true,
      desktop: false,
    });
    expect(JSON.parse(JSON.stringify(new Agent("curl/8.4.0"))).robot).toBe(
      "curl",
    );
  });
});

describe("jenssegers parity", () => {
  test("is() aliases and helpers", () => {
    const mac = new Agent(ua("Safari / macOS"));
    expect(mac.is("OS X")).toBe(true);
    expect(mac.is("Webkit")).toBe(true);
    expect(mac.isSafari() && mac.isMacOS()).toBe(true);
    const android = new Agent(ua("Chrome / Android (Pixel)"));
    expect(
      android.is("AndroidOS") && android.isAndroidOS() && android.isChrome(),
    ).toBe(true);
    const ipad = new Agent(ua("Safari / iPad"));
    expect(
      ipad.is("iOS") && ipad.isiOS() && ipad.isMobile() && !ipad.isPhone(),
    ).toBe(true);
    const ff = new Agent(ua("Firefox / Linux"));
    expect(ff.is("Webkit") || ff.isChrome()).toBe(false);
    expect(ff.isFirefox()).toBe(true);
    expect(new Agent(ua("Edge / Windows")).isEdge()).toBe(true);
    expect(new Agent(ua("Opera Mini")).isOpera()).toBe(true);
    expect(new Agent(CHROME_WIN).isWindows()).toBe(true);
    expect(new Agent(ua("IE 11")).is("Internet Explorer")).toBe(true);
  });

  test("version float and Windows NT", () => {
    const a = new Agent(ua("Safari / iPhone"));
    expect(a.version("Safari", Agent.VERSION_TYPE_FLOAT)).toBe(17.4);
    expect(a.version("iOS", "float")).toBe(17.4);
    expect(a.version("Nope", "float")).toBe(false);
    const w = new Agent(CHROME_WIN);
    expect(w.version("Windows")).toBe("10");
    expect(w.version("Windows NT")).toBe("10.0");
  });

  test("getHttpHeaders / getRules", () => {
    const headers = { "sec-ch-ua-mobile": "?0" };
    expect(new Agent(CHROME_WIN, headers).getHttpHeaders()).toBe(headers);
    expect(new Agent(CHROME_WIN).getHttpHeaders()).toEqual({});
    expect(Agent.getRules().browsers[0]![0]).toBe("Edge");
  });
});

describe("cache", () => {
  beforeEach(() => {
    setAgentCacheSize(1000);
    clearAgentCache();
  });

  test("hit returns the same frozen object", () => {
    const a = parseUserAgent(CHROME_WIN);
    expect(parseUserAgent(CHROME_WIN)).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });

  test("size cap evicts oldest; 0 disables", () => {
    setAgentCacheSize(2);
    const first = parseUserAgent("ua-1");
    parseUserAgent("ua-2");
    parseUserAgent("ua-3");
    expect(parseUserAgent("ua-1")).not.toBe(first);
    setAgentCacheSize(0);
    expect(parseUserAgent(CHROME_WIN)).not.toBe(parseUserAgent(CHROME_WIN));
  });

  test("clearAgentCache", () => {
    const a = parseUserAgent(CHROME_WIN);
    clearAgentCache();
    expect(parseUserAgent(CHROME_WIN)).not.toBe(a);
  });
});
