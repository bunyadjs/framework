import {
  BROWSERS,
  DEVICES,
  IS_ALIASES,
  PLATFORMS,
  ROBOTS,
  WEBKIT,
  type Rule,
} from "./rules.ts";
import {
  applyClientHints,
  parseUserAgent,
  readHeader,
  type DeviceType,
  type HeaderSource,
  type ParsedAgent,
} from "./parser.ts";

/** Anything that can read request headers (Bunyad `Request`, Fetch `Request`, plain objects via a wrapper). */
export interface HeaderReader {
  header(name: string): string | null | undefined;
}

export interface AgentArray extends ParsedAgent {
  mobile: boolean;
  phone: boolean;
  tablet: boolean;
  desktop: boolean;
}

const versionPatterns = new Map<string, RegExp>();
const matchPatterns = new Map<string, RegExp>();

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * User-agent inspector with the jenssegers/agent API (the Laravel ecosystem standard).
 * Parsing is lazy and cached; Client Hints win over the UA string when present.
 */
export class Agent {
  /** `version(name, Agent.VERSION_TYPE_STRING)` (default). */
  static readonly VERSION_TYPE_STRING = "text";
  /** `version(name, Agent.VERSION_TYPE_FLOAT)`: `"17.4.1"` → `17.4`. */
  static readonly VERSION_TYPE_FLOAT = "float";

  #userAgent: string;
  #headers: HeaderSource | undefined;
  #parsed: Readonly<ParsedAgent> | null = null;

  constructor(userAgent?: string | null, headers?: HeaderSource) {
    this.#userAgent = userAgent ?? "";
    this.#headers = headers;
  }

  /** Build from a request: reads `User-Agent`, Client Hints and `Accept-Language`. */
  static fromRequest(request: HeaderReader): Agent {
    return new Agent(request.header("user-agent") ?? "", (name) =>
      request.header(name),
    );
  }

  setUserAgent(userAgent: string | null): this {
    this.#userAgent = userAgent ?? "";
    this.#parsed = null;
    return this;
  }

  getUserAgent(): string {
    return this.#userAgent;
  }

  setHttpHeaders(headers: HeaderSource): this {
    this.#headers = headers;
    const ua = readHeader(headers, "user-agent");
    if (ua !== null) this.#userAgent = ua;
    this.#parsed = null;
    return this;
  }

  #info(): Readonly<ParsedAgent> {
    return (this.#parsed ??= applyClientHints(
      parseUserAgent(this.#userAgent),
      this.#headers,
    ));
  }

  /** Phone or tablet (jenssegers / Mobile_Detect semantics). */
  isMobile(): boolean {
    const t = this.#info().deviceType;
    return t === "phone" || t === "tablet";
  }

  /** Mobile and not a tablet. */
  isPhone(): boolean {
    return this.#info().deviceType === "phone";
  }

  isTablet(): boolean {
    return this.#info().deviceType === "tablet";
  }

  isDesktop(): boolean {
    return this.#info().deviceType === "desktop";
  }

  isRobot(): boolean {
    return this.#info().robot !== false;
  }

  /** Alias of `isRobot()`. */
  isBot(): boolean {
    return this.isRobot();
  }

  robot(): string | false {
    return this.#info().robot;
  }

  browser(): string | false {
    return this.#info().browser;
  }

  platform(): string | false {
    return this.#info().platform;
  }

  device(): string | false {
    return this.#info().device;
  }

  deviceType(): DeviceType {
    return this.#info().deviceType;
  }

  /**
   * Version for a browser or platform name (`version("Chrome")`, `version(agent.platform())`).
   * Windows returns the marketing version ("10", "11"); use `version("Windows NT")` for "10.0".
   * Pass `Agent.VERSION_TYPE_FLOAT` for a number (`major.minor`).
   */
  version(name: string): string | false;
  version(name: string, type: "text"): string | false;
  version(name: string, type: "float"): number | false;
  version(
    name: string,
    type: "text" | "float" = "text",
  ): string | number | false {
    const v = this.#versionText(name);
    if (v === false || type !== "float") return v;
    const parts = v.split(".");
    const n = parseFloat(
      parts.length > 1 ? `${parts[0]}.${parts[1]}` : parts[0]!,
    );
    return Number.isNaN(n) ? false : n;
  }

  #versionText(name: string): string | false {
    const info = this.#info();
    if (name === info.browser) return info.browserVersion;
    if (name === info.platform) return info.platformVersion;
    let pattern = versionPatterns.get(name);
    if (pattern === undefined) {
      pattern = new RegExp(`${escape(name)}[/ ]([\\d._]+)`, "i");
      versionPatterns.set(name, pattern);
    }
    const m = pattern.exec(this.#userAgent);
    return m ? m[1]!.replaceAll("_", ".") : false;
  }

  /** Accept-Language codes, highest quality first, lowercased (jenssegers format). */
  languages(acceptLanguage?: string | null): string[] {
    const header =
      acceptLanguage ?? readHeader(this.#headers, "accept-language");
    if (!header) return [];
    const items: Array<[string, number, number]> = [];
    const parts = header.split(",");
    for (let i = 0; i < parts.length; i++) {
      const [tag, ...params] = parts[i]!.trim().split(";");
      if (!tag || tag === "*") continue;
      let q = 1;
      for (const param of params) {
        const p = param.trim();
        if (p.startsWith("q=")) q = Number(p.slice(2)) || 0;
      }
      if (q > 0) items.push([tag.toLowerCase(), q, i]);
    }
    items.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    return items.map((item) => item[0]);
  }

  /**
   * True when the browser, platform, device or robot name equals `name` (case-insensitive).
   * Accepts jenssegers names too: "OS X" → macOS, "AndroidOS" → Android, "iOS" also matches
   * iPadOS, "Webkit" → AppleWebKit engine (Chrome-family and Safari).
   */
  is(name: string): boolean {
    const info = this.#info();
    let n = name.toLowerCase();
    n = IS_ALIASES[n] ?? n;
    if (n === "webkit") return WEBKIT.test(this.#userAgent);
    if (n === "ios" && info.platform === "iPadOS") return true;
    return (
      (info.browser !== false && info.browser.toLowerCase() === n) ||
      (info.platform !== false && info.platform.toLowerCase() === n) ||
      (info.device !== false && info.device.toLowerCase() === n) ||
      (info.robot !== false && info.robot.toLowerCase() === n)
    );
  }

  isChrome(): boolean {
    return this.#info().browser === "Chrome";
  }

  isFirefox(): boolean {
    return this.#info().browser === "Firefox";
  }

  isSafari(): boolean {
    return this.#info().browser === "Safari";
  }

  isEdge(): boolean {
    return this.#info().browser === "Edge";
  }

  isOpera(): boolean {
    const b = this.#info().browser;
    return b === "Opera" || b === "Opera Mini";
  }

  isAndroidOS(): boolean {
    return this.#info().platform === "Android";
  }

  /** iPhone, iPod or iPad (Mobile_Detect counts iPadOS as iOS). */
  isiOS(): boolean {
    const p = this.#info().platform;
    return p === "iOS" || p === "iPadOS";
  }

  isWindows(): boolean {
    return this.#info().platform === "Windows";
  }

  isMacOS(): boolean {
    return this.#info().platform === "macOS";
  }

  getHttpHeaders(): HeaderSource {
    return this.#headers ?? {};
  }

  /** The ordered detection tables (read-only). */
  static getRules(): {
    robots: readonly Rule[];
    browsers: readonly Rule[];
    platforms: readonly Rule[];
    devices: readonly Rule[];
  } {
    return {
      robots: ROBOTS,
      browsers: BROWSERS,
      platforms: PLATFORMS,
      devices: DEVICES,
    };
  }

  getRules(): ReturnType<typeof Agent.getRules> {
    return Agent.getRules();
  }

  /** Test a regex (string patterns are case-insensitive and memoized) against the UA. */
  match(pattern: string | RegExp): boolean {
    if (typeof pattern !== "string") return pattern.test(this.#userAgent);
    let re = matchPatterns.get(pattern);
    if (re === undefined) {
      re = new RegExp(pattern, "i");
      if (matchPatterns.size < 256) matchPatterns.set(pattern, re);
    }
    return re.test(this.#userAgent);
  }

  /** Plain snapshot, suited for session device lists and audit logs. */
  toArray(): AgentArray {
    const info = this.#info();
    return {
      ...info,
      mobile: info.deviceType === "phone" || info.deviceType === "tablet",
      phone: info.deviceType === "phone",
      tablet: info.deviceType === "tablet",
      desktop: info.deviceType === "desktop",
    };
  }

  toJSON(): AgentArray {
    return this.toArray();
  }
}

/** `agent(request)`: an `Agent` for the current request (Bunyad `Request` has no macros, so this is the integration point). */
export function agent(request: HeaderReader): Agent {
  return Agent.fromRequest(request);
}
