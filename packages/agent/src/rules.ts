/**
 * Ordered, precompiled detection tables. First match wins, so specific
 * tokens (Edge, Opera, Samsung...) must come before the generic ones they
 * also contain (Chrome, Safari).
 */

export type Rule = readonly [name: string, pattern: RegExp];

/**
 * "bot"-shaped tokens, case-sensitive on purpose: `Googlebot`, `bingbot`,
 * `GPTBot`, `Bot/`, standalone `bot` match; device names such as `CUBOT`,
 * words like `Robotics` or `Abbott` do not.
 */
export const BOT_TOKEN = /[a-z]bot(?![a-z])|Bot\b|\bbot\b/;

/** Other bot-shaped tokens (case-insensitive). */
export const BOT_WORDS =
  /crawl|spider|slurp|curl\/|wget|python-requests|go-http-client|postmanruntime|headlesschrome|facebookexternalhit|whatsapp|bytespider|lighthouse/i;

export const ROBOTS: readonly Rule[] = [
  [
    "Googlebot",
    /googlebot|google-inspectiontool|adsbot-google|mediapartners-google/i,
  ],
  ["Bingbot", /bingbot|bingpreview/i],
  ["Yahoo! Slurp", /slurp/i],
  ["DuckDuckBot", /duckduckbot/i],
  ["Baiduspider", /baiduspider/i],
  ["YandexBot", /yandexbot|yandex\.com\/bots/i],
  ["Applebot", /applebot/i],
  ["Facebook", /facebookexternalhit|facebookbot/i],
  ["Twitterbot", /twitterbot/i],
  ["LinkedInBot", /linkedinbot/i],
  ["Slackbot", /slackbot/i],
  ["Discordbot", /discordbot/i],
  ["TelegramBot", /telegrambot/i],
  ["WhatsApp", /whatsapp/i],
  ["AhrefsBot", /ahrefsbot/i],
  ["SemrushBot", /semrushbot/i],
  ["GPTBot", /gptbot|chatgpt-user|oai-searchbot/i],
  ["ClaudeBot", /claudebot|claude-web|anthropic-ai/i],
  ["PerplexityBot", /perplexitybot/i],
  ["Bytespider", /bytespider/i],
  ["Lighthouse", /lighthouse/i],
  ["HeadlessChrome", /headlesschrome/i],
  ["curl", /curl\//i],
  ["Wget", /wget/i],
  ["Python Requests", /python-requests/i],
  ["Go HTTP", /go-http-client/i],
  ["Postman", /postmanruntime/i],
  ["Bot", BOT_TOKEN],
  ["Bot", /crawl|spider/i],
];

/** Browser rules: capture group 1 is the version. */
export const BROWSERS: readonly Rule[] = [
  ["Edge", /(?:Edg|EdgA|EdgiOS|Edge)\/([\d.]+)/],
  ["Opera Mini", /Opera Mini\/([\d.]+)/],
  [
    "Opera",
    /(?:OPR|OPiOS|OPT)\/([\d.]+)|Opera\/.*Version\/([\d.]+)|Opera[ /]([\d.]+)/,
  ],
  ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
  ["UC Browser", /UCBrowser\/([\d.]+)/],
  ["Yandex", /YaBrowser\/([\d.]+)/],
  ["Vivaldi", /Vivaldi\/([\d.]+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
  ["Chrome", /(?:CriOS|Chrome)\/([\d.]+)/],
  ["Safari", /Version\/([\d.]+).*Safari\//],
  ["IE", /MSIE ([\d.]+)|Trident\/.*rv:([\d.]+)/],
];

export const PLATFORMS: readonly Rule[] = [
  ["iPadOS", /iPad.*? OS ([\d_]+)|iPad()/],
  ["iOS", /(?:iPhone|iPod).*? OS ([\d_]+)|(?:iPhone|iPod)()/],
  ["Android", /Android[ /]?([\d.]*)/],
  ["ChromeOS", /CrOS [\w]+ ([\d.]+)|CrOS()/],
  ["macOS", /Macintosh.*?Mac OS X ([\d_.]+)|Mac(?:intosh| OS X)()/],
  ["Windows", /Windows NT ([\d.]+)|Windows()/],
  ["Linux", /Linux()/],
];

export const WINDOWS_NT: Readonly<Record<string, string>> = {
  "10.0": "10",
  "6.3": "8.1",
  "6.2": "8",
  "6.1": "7",
  "6.0": "Vista",
  "5.1": "XP",
};

export const DEVICES: readonly Rule[] = [
  ["iPad", /iPad/],
  ["iPhone", /iPhone/],
  ["iPod", /iPod/],
  ["Kindle", /Kindle|Silk\//],
  ["Pixel", /Pixel/],
  ["Samsung", /SM-[A-Z]|SAMSUNG|Galaxy/i],
  ["Huawei", /Huawei|HUAWEI|; (?:ELE|VOG|ANE|LYA)-/],
  ["Xiaomi", /Xiaomi|Redmi|; M\d{4}/],
  ["Macintosh", /Macintosh/],
];

export const TABLET =
  /iPad|Tablet|Kindle|Silk\/|PlayBook|Nexus (?:7|9|10)|SM-T\d/i;
export const MOBILE =
  /Mobi|iPhone|iPod|Opera Mini|Windows Phone|IEMobile|BlackBerry/i;

/** Client Hints brand → Bunyad browser name. */
export const HINT_BRANDS: Readonly<Record<string, string>> = {
  "Google Chrome": "Chrome",
  "Microsoft Edge": "Edge",
  Opera: "Opera",
  "Opera GX": "Opera",
  Brave: "Brave",
  "Samsung Internet": "Samsung Internet",
  YaBrowser: "Yandex",
  Yandex: "Yandex",
  Vivaldi: "Vivaldi",
  Chromium: "Chrome",
};

export const HINT_PLATFORMS: Readonly<Record<string, string>> = {
  windows: "Windows",
  macos: "macOS",
  android: "Android",
  "chrome os": "ChromeOS",
  chromeos: "ChromeOS",
  linux: "Linux",
  ios: "iOS",
};

/** Aliases accepted by `is()` (jenssegers / Mobile_Detect names → canonical, lowercased). */
export const IS_ALIASES: Readonly<Record<string, string>> = {
  "os x": "macos",
  osx: "macos",
  "mac os": "macos",
  androidos: "android",
  "chrome os": "chromeos",
  "microsoft edge": "edge",
  msie: "ie",
  "internet explorer": "ie",
  samsung: "samsung internet",
  samsungbrowser: "samsung internet",
  ucbrowser: "uc browser",
  opera: "opera",
};

export const WEBKIT = /AppleWebKit\//;
