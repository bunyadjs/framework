/**
 * Laravel-like markdown mail theme (card layout, button, subcopy, header/footer).
 * CSS is inlined for email-client compatibility (same approach as Illuminate\Mail\Markdown).
 */

import { markdownToHtml } from "./markdown.ts";

export type MailButtonColor = "primary" | "success" | "error" | "blue" | "green" | "red";

export type MailMarkdownDefaults = {
  /** Theme name (reserved; only `default` ships today). */
  theme?: string;
  /** Brand name shown in header text fallback + footer + default salutation. */
  appName?: string;
  /** Optional logo image URL (absolute http(s) or cid:…). */
  logoUrl?: string;
  /** Copyright year in footer (default: current year). */
  year?: number;
};

export type NotificationMailContent = {
  level?: string;
  greeting?: string;
  introLines?: string[];
  actionText?: string;
  actionUrl?: string;
  outroLines?: string[];
  salutation?: string;
  appName?: string;
  logoUrl?: string;
  year?: number;
  /** Header brand URL (defaults to `#`). */
  headerUrl?: string;
};

let defaults: MailMarkdownDefaults = {
  theme: "default",
  appName: "Bunyad",
};

/** Configure global markdown/theme defaults (app name, logo, …). */
export function setMailMarkdownDefaults(
  options: MailMarkdownDefaults | null,
): void {
  if (options == null) {
    defaults = { theme: "default", appName: "Bunyad" };
    return;
  }
  defaults = { ...defaults, ...options };
}

export function getMailMarkdownDefaults(): MailMarkdownDefaults {
  return { ...defaults };
}

/** Escape text for HTML attribute / body contexts. */
export function escapeMailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buttonColorClass(color: MailButtonColor | string | undefined): string {
  switch (color) {
    case "success":
    case "green":
      return "button-success";
    case "error":
    case "red":
      return "button-error";
    case "blue":
    case "primary":
    default:
      return "button-primary";
  }
}

/** Centered CTA button (Laravel `mail::button`). */
export function renderMailButton(options: {
  url: string;
  text: string;
  color?: MailButtonColor | string;
}): string {
  const colorClass = buttonColorClass(options.color);
  const url = escapeMailHtml(options.url);
  const text = escapeMailHtml(options.text);
  return `<table class="action" align="center" width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td align="center">
<table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td align="center">
<table border="0" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td>
<a href="${url}" class="button ${colorClass}" target="_blank" rel="noopener">${text}</a>
</td>
</tr>
</table>
</td>
</tr>
</table>
</td>
</tr>
</table>`;
}

/** Brand header (Laravel `mail::header`). */
export function renderMailHeader(options: {
  appName: string;
  logoUrl?: string;
  url?: string;
}): string {
  const href = escapeMailHtml(options.url ?? "#");
  const name = escapeMailHtml(options.appName);
  // Empty alt when a logo is present — logos often already include the brand
  // wordmark; repeating it via alt + salutation/footer looked like duplicate text.
  const inner = options.logoUrl
    ? `<img src="${escapeMailHtml(options.logoUrl)}" alt="" style="max-height:75px;max-width:240px;width:auto;height:auto;" class="logo">`
    : name;
  return `<tr>
<td class="header">
<a href="${href}" style="display:inline-block;">
${inner}
</a>
</td>
</tr>`;
}

/** Footer (Laravel `mail::footer`). */
export function renderMailFooter(options: {
  appName: string;
  year?: number;
}): string {
  const year = options.year ?? new Date().getFullYear();
  const name = escapeMailHtml(options.appName);
  return `<tr>
<td>
<table class="footer" align="center" width="570" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td class="content-cell" align="center">
<p>© ${year} ${name}. All rights reserved.</p>
</td>
</tr>
</table>
</td>
</tr>`;
}

/** Subcopy under the body (Laravel `mail::subcopy`). */
export function renderMailSubcopy(html: string): string {
  return `<table class="subcopy" width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td>
${html}
</td>
</tr>
</table>`;
}

/** Full HTML document shell with inlined default theme CSS. */
export function renderMailLayout(options: {
  appName: string;
  headerHtml: string;
  bodyHtml: string;
  subcopyHtml?: string;
  footerHtml: string;
}): string {
  const title = escapeMailHtml(options.appName);
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>
${DEFAULT_THEME_CSS}
</style>
</head>
<body>
<table class="wrapper" width="100%" cellpadding="0" cellspacing="0" role="presentation">
<tr>
<td align="center">
<table class="content" width="100%" cellpadding="0" cellspacing="0" role="presentation">
${options.headerHtml}
<!-- Email Body -->
<tr>
<td class="body" width="100%" cellpadding="0" cellspacing="0" style="border:hidden !important;">
<table class="inner-body" align="center" width="570" cellpadding="0" cellspacing="0" role="presentation">
<!-- Body content -->
<tr>
<td class="content-cell">
${options.bodyHtml}
${options.subcopyHtml ?? ""}
</td>
</tr>
</table>
</td>
</tr>
${options.footerHtml}
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

/**
 * Render a Laravel-style notification email (greeting, lines, CTA, salutation, subcopy).
 */
export function renderNotificationMailHtml(
  content: NotificationMailContent,
): string {
  const appName = content.appName ?? defaults.appName ?? "Bunyad";
  const logoUrl = content.logoUrl ?? defaults.logoUrl;
  const year = content.year ?? defaults.year;
  const level = content.level ?? "info";
  const greeting =
    content.greeting ??
    (level === "error" ? "Whoops!" : "Hello!");
  const salutation =
    content.salutation ?? `Regards,\n${appName}`;

  const bodyParts: string[] = [];
  bodyParts.push(`<h1>${escapeMailHtml(greeting)}</h1>`);

  for (const line of content.introLines ?? []) {
    bodyParts.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }

  if (content.actionText && content.actionUrl) {
    const color: MailButtonColor =
      level === "success"
        ? "success"
        : level === "error"
          ? "error"
          : "primary";
    bodyParts.push(
      renderMailButton({
        url: content.actionUrl,
        text: content.actionText,
        color,
      }),
    );
  }

  for (const line of content.outroLines ?? []) {
    bodyParts.push(`<p>${formatInlineMarkdown(line)}</p>`);
  }

  bodyParts.push(`<p>${formatSalutation(salutation)}</p>`);

  let subcopyHtml: string | undefined;
  if (content.actionText && content.actionUrl) {
    const actionText = escapeMailHtml(content.actionText);
    const actionUrl = escapeMailHtml(content.actionUrl);
    subcopyHtml = renderMailSubcopy(
      `<p>If you're having trouble clicking the "${actionText}" button, copy and paste the URL below into your web browser: <span class="break-all"><a href="${actionUrl}">${actionUrl}</a></span></p>`,
    );
  }

  return renderMailLayout({
    appName,
    headerHtml: renderMailHeader({
      appName,
      logoUrl,
      url: content.headerUrl,
    }),
    bodyHtml: bodyParts.join("\n"),
    subcopyHtml,
    footerHtml: renderMailFooter({ appName, year }),
  });
}

/**
 * Convert markdown mail source into themed HTML.
 * Supports optional `<x-mail::message>` wrapper and `<x-mail::button url="…">Label</x-mail::button>`.
 * When no message wrapper is present, the converted body is wrapped in the default card layout.
 */
export function renderMarkdownMail(
  source: string,
  options: MailMarkdownDefaults = {},
): { html: string; text: string } {
  const appName = options.appName ?? defaults.appName ?? "Bunyad";
  const logoUrl = options.logoUrl ?? defaults.logoUrl;
  const year = options.year ?? defaults.year;

  let body = source.replaceAll(/\r\n/g, "\n").trim();

  // If the source is already a full themed document (e.g. mailable passed
  // renderNotificationMailHtml output as markdown by mistake), do not wrap again.
  if (body.includes('class="wrapper"') && body.includes('class="inner-body"')) {
    return { html: body, text: stripToPlain(source) };
  }


  const messageMatch = body.match(
    /<x-mail::message\b[^>]*>([\s\S]*?)<\/x-mail::message>/i,
  );
  if (messageMatch) {
    body = messageMatch[1]!.trim();
  }

  // Replace button components before markdown conversion.
  body = body.replace(
    /<x-mail::button\b([^>]*)>([\s\S]*?)<\/x-mail::button>/gi,
    (_full, attrs: string, slot: string) => {
      const url = attrValue(attrs, "url") ?? attrValue(attrs, ":url") ?? "#";
      const color = attrValue(attrs, "color") ?? "primary";
      return `\n\n{{MAIL_BUTTON:${encodeURIComponent(url)}|${encodeURIComponent(color)}|${encodeURIComponent(slot.trim())}}}\n\n`;
    },
  );

  // Also support Laravel-ish @component('mail::button', ['url' => '...'])
  body = body.replace(
    /@component\(\s*['"]mail::button['"]\s*,\s*\[([^\]]*)\]\s*\)\s*\n([\s\S]*?)\n\s*@endcomponent/gi,
    (_full, arr: string, slot: string) => {
      const url =
        arr.match(/['"]url['"]\s*=>\s*['"]([^'"]+)['"]/)?.[1] ??
        arr.match(/url\s*:\s*['"]([^'"]+)['"]/)?.[1] ??
        "#";
      const color =
        arr.match(/['"]color['"]\s*=>\s*['"]([^'"]+)['"]/)?.[1] ?? "primary";
      return `\n\n{{MAIL_BUTTON:${encodeURIComponent(url)}|${encodeURIComponent(color)}|${encodeURIComponent(slot.trim())}}}\n\n`;
    },
  );

  let htmlBody = markdownToHtml(body);

  htmlBody = htmlBody.replace(
    /\{\{MAIL_BUTTON:([^|]+)\|([^|]+)\|([^}]+)\}\}/g,
    (_full, urlEnc: string, colorEnc: string, textEnc: string) =>
      renderMailButton({
        url: decodeURIComponent(urlEnc),
        color: decodeURIComponent(colorEnc),
        text: decodeURIComponent(textEnc),
      }),
  );

  const text = stripToPlain(source);

  let actionUrl: string | undefined;
  let actionText: string | undefined;
  const btn = htmlBody.match(
    /<a href="([^"]+)" class="button[^"]*"[^>]*>([^<]*)<\/a>/,
  );
  if (btn) {
    actionUrl = btn[1];
    actionText = btn[2];
  }

  let subcopyHtml: string | undefined;
  if (actionText && actionUrl) {
    subcopyHtml = renderMailSubcopy(
      `<p>If you're having trouble clicking the "${escapeMailHtml(actionText)}" button, copy and paste the URL below into your web browser: <span class="break-all"><a href="${escapeMailHtml(actionUrl)}">${escapeMailHtml(actionUrl)}</a></span></p>`,
    );
  }

  const html = renderMailLayout({
    appName,
    headerHtml: renderMailHeader({ appName, logoUrl }),
    bodyHtml: htmlBody,
    subcopyHtml,
    footerHtml: renderMailFooter({ appName, year }),
  });

  return { html, text };
}


function attrValue(attrs: string, name: string): string | undefined {
  const re = new RegExp(
    `(?:^|\\s)${name.replace(":", "\\:")}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const m = attrs.match(re);
  return m?.[1] ?? m?.[2] ?? m?.[3];
}

/** Very small inline markdown for notification lines (`**bold**`, links). */
function formatInlineMarkdown(line: string): string {
  return escapeMailHtml(line)
    .replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replaceAll(/\*(.+?)\*/g, "<em>$1</em>")
    .replaceAll(
      /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2">$1</a>',
    );
}

function formatSalutation(salutation: string): string {
  return escapeMailHtml(salutation).replaceAll("\n", "<br>\n");
}

function stripToPlain(source: string): string {
  return source
    .replace(/<x-mail::button\b[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/x-mail::button>/gi, "$2: $1")
    .replace(/<\/?x-mail::[^>]+>/gi, "")
    .replace(/@component\([^)]*\)/gi, "")
    .replace(/@endcomponent/gi, "")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

/** Laravel framework default theme CSS (inlined). */
export const DEFAULT_THEME_CSS = `/* Base */
body, body *:not(html):not(style):not(br):not(tr):not(code) {
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';
  position: relative;
}
body {
  -webkit-text-size-adjust: none;
  background-color: #ffffff;
  color: #52525b;
  height: 100%;
  line-height: 1.4;
  margin: 0;
  padding: 0;
  width: 100% !important;
}
p, ul, ol, blockquote {
  line-height: 1.4;
  text-align: start;
}
a { color: #18181b; }
a img { border: none; }
h1 {
  color: #18181b;
  font-size: 18px;
  font-weight: bold;
  margin-top: 0;
  text-align: start;
}
h2 {
  font-size: 16px;
  font-weight: bold;
  margin-top: 0;
  text-align: start;
}
h3 {
  font-size: 14px;
  font-weight: bold;
  margin-top: 0;
  text-align: left;
}
p {
  font-size: 16px;
  line-height: 1.5em;
  margin-top: 0;
  text-align: left;
}
p.sub { font-size: 12px; }
img { max-width: 100%; }
.wrapper {
  background-color: #fafafa;
  margin: 0;
  padding: 0;
  width: 100%;
}
.content {
  margin: 0;
  padding: 0;
  width: 100%;
}
.header {
  padding: 25px 0;
  text-align: center;
}
.header a {
  color: #18181b;
  font-size: 19px;
  font-weight: bold;
  text-decoration: none;
}
.logo {
  height: auto;
  margin-top: 15px;
  margin-bottom: 10px;
  max-height: 75px;
  max-width: 240px;
  width: auto;
}
.body {
  background-color: #fafafa;
  border-bottom: 1px solid #fafafa;
  border-top: 1px solid #fafafa;
  margin: 0;
  padding: 0;
  width: 100%;
}
.inner-body {
  background-color: #ffffff;
  border-color: #e4e4e7;
  border-radius: 4px;
  border-width: 1px;
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
  margin: 0 auto;
  padding: 0;
  width: 570px;
}
.inner-body a { word-break: break-all; }
.subcopy {
  border-top: 1px solid #e4e4e7;
  margin-top: 25px;
  padding-top: 25px;
}
.subcopy p { font-size: 14px; }
.footer {
  margin: 0 auto;
  padding: 0;
  text-align: center;
  width: 570px;
}
.footer p {
  color: #a1a1aa;
  font-size: 12px;
  text-align: center;
}
.footer a {
  color: #a1a1aa;
  text-decoration: underline;
}
.content-cell {
  max-width: 100vw;
  padding: 32px;
}
.action {
  margin: 30px auto;
  padding: 0;
  text-align: center;
  width: 100%;
  float: unset;
}
.button {
  -webkit-text-size-adjust: none;
  border-radius: 4px;
  color: #fff;
  display: inline-block;
  overflow: hidden;
  text-decoration: none;
}
.button-blue,
.button-primary {
  background-color: #18181b;
  border-bottom: 8px solid #18181b;
  border-left: 18px solid #18181b;
  border-right: 18px solid #18181b;
  border-top: 8px solid #18181b;
}
.button-green,
.button-success {
  background-color: #16a34a;
  border-bottom: 8px solid #16a34a;
  border-left: 18px solid #16a34a;
  border-right: 18px solid #16a34a;
  border-top: 8px solid #16a34a;
}
.button-red,
.button-error {
  background-color: #dc2626;
  border-bottom: 8px solid #dc2626;
  border-left: 18px solid #dc2626;
  border-right: 18px solid #dc2626;
  border-top: 8px solid #dc2626;
}
.break-all { word-break: break-all; }
@media only screen and (max-width: 600px) {
  .inner-body { width: 100% !important; }
  .footer { width: 100% !important; }
}
@media only screen and (max-width: 500px) {
  .button { width: 100% !important; }
}`;
