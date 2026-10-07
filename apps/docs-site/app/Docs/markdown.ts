import { Marked } from "marked";

export type Heading = {
  level: 2 | 3;
  text: string;
  id: string;
};

export type CodeSample = {
  code: string;
  lang: string;
  title?: string;
};

export type TabGroup = {
  tabs: Array<{ label: string; sample: CodeSample }>;
};

const fence =
  /```([^\n`]*)\n([\s\S]*?)```/g;

/** GitHub-style heading slug. */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "section";
}

export function parseFrontmatter(source: string): {
  meta: Record<string, string>;
  body: string;
} {
  if (!source.startsWith("---\n")) {
    return { meta: {}, body: source };
  }
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of source.slice(4, end).split("\n")) {
    const split = line.indexOf(":");
    if (split === -1) continue;
    meta[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return { meta, body: source.slice(end + 5) };
}

export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2]!.replace(/`/g, "");
    let id = slugify(text);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count > 0) id = `${id}-${count}`;
    headings.push({
      level: match[1]!.length as 2 | 3,
      text,
      id,
    });
  }
  return headings;
}

function uniqueId(text: string, seen: Map<string, number>): string {
  let id = slugify(text);
  const count = seen.get(id) ?? 0;
  seen.set(id, count + 1);
  if (count > 0) id = `${id}-${count}`;
  return id;
}

function parseFenceInfo(info: string): { lang: string; title?: string } {
  const title = /title="([^"]+)"/.exec(info)?.[1];
  const lang = info.replace(/title="[^"]*"/, "").trim().split(/\s+/)[0] || "text";
  return { lang, title };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Pull fenced samples, tab groups, and callouts out of the markdown
 * so the highlighter owns them.
 */
export function extractBlocks(markdown: string): {
  markdown: string;
  codes: CodeSample[];
  tabs: TabGroup[];
  callouts: Array<{ type: string; markdown: string }>;
} {
  const codes: CodeSample[] = [];
  const tabs: TabGroup[] = [];
  const callouts: Array<{ type: string; markdown: string }> = [];

  let next = markdown.replace(
    /:::tabs\n([\s\S]*?):::/g,
    (_all, inner: string) => {
      const group: TabGroup = { tabs: [] };
      for (const match of inner.matchAll(fence)) {
        const info = parseFenceInfo(match[1] ?? "");
        group.tabs.push({
          label: info.title ?? info.lang,
          sample: { code: match[2] ?? "", lang: info.lang },
        });
      }
      const index = tabs.push(group) - 1;
      return `\n\n%%TABS_${index}%%\n\n`;
    },
  );

  next = next.replace(
    /:::(note|tip|warning)\n([\s\S]*?):::/g,
    (_all, type: string, inner: string) => {
      const index = callouts.push({ type, markdown: inner.trim() }) - 1;
      return `\n\n%%CALLOUT_${index}%%\n\n`;
    },
  );

  next = next.replace(fence, (_all, info: string, code: string) => {
    const parsed = parseFenceInfo(info);
    const index =
      codes.push({ code, lang: parsed.lang, title: parsed.title }) - 1;
    return `\n\n%%CODE_${index}%%\n\n`;
  });

  return { markdown: next, codes, tabs, callouts };
}

const SHIKI_LANG: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  shell: "bash",
  bash: "bash",
  sh: "bash",
  json: "json",
  html: "html",
  view: "html",
  env: "dotenv",
  text: "text",
  md: "markdown",
};

export async function highlight(sample: CodeSample): Promise<string> {
  const { codeToHtml } = await import("shiki");
  const lang = SHIKI_LANG[sample.lang] ?? "text";
  const html = await codeToHtml(sample.code.replace(/\n$/, ""), {
    lang,
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
    defaultColor: false,
  });
  const title = sample.title
    ? `<span class="code-title">${escapeHtml(sample.title)}</span>`
    : "<span></span>";
  return `<div class="code-block">${title}<button type="button" class="copy" data-code="${encodeURIComponent(sample.code)}">Copy</button>${html}</div>`;
}

const labels: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
};

/** A wide table scrolls inside its own box instead of widening the whole page on a phone. */
export function wrapTables(html: string): string {
  const open = '<div class="table-wrap" tabindex="0">';
  // The lookbehind keeps a second pass from wrapping a table that is already in its box.
  return html.replace(
    /(?<!<div class="table-wrap" tabindex="0">)<table>[\s\S]*?<\/table>/g,
    (table) => `${open}${table}</div>`,
  );
}

export async function renderMarkdown(body: string): Promise<{
  html: string;
  headings: Heading[];
}> {
  const headings = extractHeadings(body);
  const blocks = extractBlocks(body);
  const seen = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ text, depth }) {
        const plain = text.replace(/<[^>]+>/g, "");
        if (depth < 2 || depth > 3) {
          return `<h${depth}>${text}</h${depth}>\n`;
        }
        const id = uniqueId(plain, seen);
        return `<h${depth} id="${id}"><a class="heading-anchor" href="#${id}">${text}</a></h${depth}>\n`;
      },
    },
  });

  let html = wrapTables(await marked.parse(blocks.markdown));
  html = html.replace(
    /<p>\s*%%((?:CODE|TABS|CALLOUT)_\d+)%%\s*<\/p>/g,
    "%%$1%%",
  );

  for (let i = 0; i < blocks.codes.length; i++) {
    html = html.replace(`%%CODE_${i}%%`, await highlight(blocks.codes[i]!));
  }

  for (let i = 0; i < blocks.tabs.length; i++) {
    const group = blocks.tabs[i]!;
    const buttons = group.tabs
      .map(
        (tab, index) =>
          `<button type="button" class="tab" role="tab" aria-selected="${index === 0 ? "true" : "false"}" data-tab="${index}">${escapeHtml(tab.label)}</button>`,
      )
      .join("");
    const panels = await Promise.all(
      group.tabs.map(async (tab, index) => {
        const hidden = index === 0 ? "" : " hidden";
        return `<div class="tab-panel" role="tabpanel"${hidden}>${await highlight(tab.sample)}</div>`;
      }),
    );
    html = html.replace(
      `%%TABS_${i}%%`,
      `<div class="tabs"><div class="tab-list" role="tablist">${buttons}</div>${panels.join("")}</div>`,
    );
  }

  for (let i = 0; i < blocks.callouts.length; i++) {
    const callout = blocks.callouts[i]!;
    const inner = wrapTables(await marked.parse(callout.markdown));
    html = html.replace(
      `%%CALLOUT_${i}%%`,
      `<aside class="callout callout-${callout.type}"><p class="callout-label">${labels[callout.type] ?? "Note"}</p>${inner}</aside>`,
    );
  }

  return { html, headings };
}
