import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentVersion,
  flatPages,
  nav,
  pagePath,
  versions,
  type DocPage,
} from "./nav.ts";
import { parseFrontmatter, renderMarkdown, type Heading } from "./markdown.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const contentDir = join(root, "resources/docs/1.x");

export type BuiltPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  path: string;
  headings: Heading[];
  html: string;
  markdown: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function buildPage(
  page: ReturnType<typeof flatPages>[number],
): Promise<BuiltPage> {
  const source = readFileSync(join(contentDir, page.file), "utf8");
  const { meta, body } = parseFrontmatter(source);
  if (!meta.title || !meta.description) {
    throw new Error(`${page.file} is missing title or description`);
  }
  const rendered = await renderMarkdown(body);
  return {
    slug: page.slug,
    title: meta.title,
    description: meta.description,
    group: page.group,
    path: pagePath(currentVersion.id, page.slug),
    headings: rendered.headings,
    html: rendered.html,
    markdown: body.trim(),
  };
}

export function contentFile(file: string): string {
  return join(contentDir, file);
}

export async function loadPages(): Promise<BuiltPage[]> {
  const built: BuiltPage[] = [];
  for (const page of flatPages()) {
    built.push(await buildPage(page));
  }
  return built;
}

function sidebar(current: string): string {
  const groups = nav
    .map((group) => {
      const isOpen = group.pages.some((page) => page.slug === current);
      const links = group.pages
        .map((page) => {
          const href = pagePath(currentVersion.id, page.slug);
          const active = page.slug === current ? " is-active" : "";
          const currentAttr =
            page.slug === current ? ' aria-current="page"' : "";
          return `<a class="side-link${active}" href="${href}"${currentAttr}>${escapeHtml(page.title)}</a>`;
        })
        .join("");
      const openAttr = isOpen ? " open" : "";
      return `<details class="side-group"${openAttr}><summary class="side-label">${escapeHtml(group.title)}</summary><div class="side-links">${links}</div></details>`;
    })
    .join("");
  return `<nav class="sidebar" aria-label="Documentation">${groups}</nav>`;
}

function themeIcon(kind: "sun" | "moon" | "system"): string {
  if (kind === "sun") {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
  }
  if (kind === "moon") {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
}

function menuIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`;
}

function searchIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>`;
}

function closeIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
}

function toc(headings: Heading[]): string {
  if (headings.length === 0) return "";
  const items = headings
    .map(
      (heading) =>
        `<a class="toc-link toc-${heading.level}" href="#${heading.id}">${escapeHtml(heading.text)}</a>`,
    )
    .join("");
  const list = `<p class="toc-label">On this page</p><nav class="toc-list" aria-label="On this page">${items}</nav>`;
  return `<aside class="toc">${list}</aside><details class="toc-mobile"><summary>On this page</summary>${list}</details>`;
}

function neighbors(pages: BuiltPage[], index: number): string {
  const prev = pages[index - 1];
  const next = pages[index + 1];
  const prevHtml = prev
    ? `<a class="pager-link" href="${prev.path}"><span>Previous</span><strong>${escapeHtml(prev.title)}</strong></a>`
    : "<span></span>";
  const nextHtml = next
    ? `<a class="pager-link pager-next" href="${next.path}"><span>Next</span><strong>${escapeHtml(next.title)}</strong></a>`
    : "<span></span>";
  return `<nav class="pager" aria-label="Pages">${prevHtml}${nextHtml}</nav>`;
}

function versionMenu(): string {
  const items = versions
    .map((version) => {
      const href = pagePath(version.id, "");
      const mark = version.latest ? " <span class=\"latest\">Latest</span>" : "";
      return `<a role="menuitem" href="${href}">${escapeHtml(version.label)}${mark}</a>`;
    })
    .join("");
  return `<div class="version"><button type="button" class="version-button" aria-expanded="false" aria-haspopup="menu">Version ${escapeHtml(currentVersion.label)}</button><div class="version-menu" role="menu" hidden>${items}</div></div>`;
}

export function renderDocument(page: BuiltPage, pages: BuiltPage[]): string {
  const index = pages.findIndex((item) => item.slug === page.slug);
  const outline = toc(page.headings);
  const mobileToc = outline.match(/<details class="toc-mobile">[\s\S]*<\/details>/)?.[0] ?? "";
  const desktopToc = outline.replace(mobileToc, "");
  const css = "/assets/styles.css";
  const client = "/assets/client.js";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(page.title)} — Bunyad</title>
<meta name="description" content="${escapeHtml(page.description)}"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="preconnect" href="https://fonts.bunny.net"/>
<link href="https://fonts.bunny.net/css?family=instrument-sans:400,500,600,700|jetbrains-mono:400,500" rel="stylesheet"/>
<script>
(function () {
  try {
    var stored = localStorage.getItem("bunyad-docs-theme") || "system";
    var dark = stored === "dark" || (stored !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.add(dark ? "dark" : "light");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = stored;
  } catch (e) {
    document.documentElement.classList.add("light");
  }
})();
</script>
<link rel="stylesheet" href="${css}"/>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="header">
  <div class="header-start">
    <button type="button" class="icon-button menu-button" aria-expanded="false" aria-controls="drawer" aria-label="Open menu">${menuIcon()}</button>
    <a class="logo" href="${pagePath(currentVersion.id, "")}">Bunyad</a>
  </div>
  <button type="button" class="search-trigger"><span>Search</span><kbd>⌘K</kbd></button>
  <div class="header-end">
    ${versionMenu()}
    <button type="button" class="icon-button search-icon" aria-label="Search">${searchIcon()}</button>
    <button type="button" class="icon-button theme-button" aria-label="Theme: system. Activate to change." data-theme-icons="1">${themeIcon("system")}</button>
  </div>
</header>
<div class="backdrop" hidden></div>
<div class="drawer" id="drawer" hidden>
  <div class="drawer-head"><strong>1.x</strong><button type="button" class="icon-button close-drawer" aria-label="Close">${closeIcon()}</button></div>
  ${sidebar(page.slug)}
</div>
<div class="layout">
  ${sidebar(page.slug)}
  <main id="content">
    ${mobileToc}
    <article class="prose">${page.html}</article>
    ${neighbors(pages, index)}
  </main>
  ${desktopToc}
</div>
<dialog class="search-dialog" aria-label="Search docs">
  <input class="search-input" type="search" placeholder="Search docs" aria-label="Search docs"/>
  <div class="search-results" role="listbox"></div>
</dialog>
<script src="${client}"></script>
</body>
</html>`;
}

export function searchIndex(pages: BuiltPage[]) {
  return pages.map((page) => ({
    title: page.title,
    description: page.description,
    path: page.path,
    group: page.group,
    headings: page.headings.map((heading) => ({
      text: heading.text,
      id: heading.id,
    })),
  }));
}

export type { DocPage };
