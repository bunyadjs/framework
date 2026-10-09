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
  #userAgent: string;
  #headers: HeaderSource | undefined;
  #parsed: Readonly<ParsedAgent> | null = null;

  constructor(userAgent?: string | null, headers?: HeaderSource) {
    this.#userAgent = userAgent ?? "";
    this.#headers = headers;
  }

  /** Build from a request: reads `User-Agent`, Client Hints and `Accept-Language`. */
  static fromRequest(request: HeaderReader): Agent {
    return new Agent(request.header("user-agent") ?? "", (name) => request.header(name));
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
    return (this.#parsed ??= applyClientHints(parseUserAgent(this.#userAgent), this.#headers));
  }

  isMobile(): boolean {
    return this.#info().deviceType === "mobile";
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

  /** Version for a browser or platform name (`version("Chrome")`, `version(agent.platform())`). */
  version(name: string): string | false {
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
    const header = acceptLanguage ?? readHeader(this.#headers, "accept-language");
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

  /** True when the browser, platform, device or robot name equals `name` (case-insensitive). */
  is(name: string): boolean {
    const info = this.#info();
    const n = name.toLowerCase();
    for (const v of [info.browser, info.platform, info.device, info.robot]) {
      if (v !== false && v.toLowerCase() === n) return true;
    }
    return false;
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
      mobile: info.deviceType === "mobile",
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
