const themeButton = document.querySelector(".theme-button");
const menuButton = document.querySelector(".menu-button");
const drawer = document.querySelector(".drawer");
const backdrop = document.querySelector(".backdrop");
const closeDrawer = document.querySelector(".close-drawer");
const versionButton = document.querySelector(".version-button");
const versionMenu = document.querySelector(".version-menu");
const searchButtons = document.querySelectorAll(".search-trigger, .search-icon");
const dialog = document.querySelector(".search-dialog");
const searchInput = document.querySelector(".search-input");
const searchResults = document.querySelector(".search-results");

const order = ["light", "dark", "system"];

const themeIcons = {
  light: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
  dark: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"/></svg>`,
  system: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
};

const hashIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 9h14M5 15h14M10 3 8 21M16 3l-2 18"/></svg>`;
const pageIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`;
const enterIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 10h10v8M9 18l-4-4 4-4"/></svg>`;

function resolvedDark(mode) {
  return mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
}

function applyTheme(mode) {
  const dark = resolvedDark(mode);
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(dark ? "dark" : "light");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  document.documentElement.dataset.theme = mode;
  if (themeButton) {
    const label = mode === "system" ? "System" : mode === "dark" ? "Dark" : "Light";
    themeButton.innerHTML = themeIcons[mode] || themeIcons.system;
    themeButton.setAttribute("aria-label", `Theme: ${label}. Activate to change.`);
    themeButton.title = label;
  }
}

applyTheme(document.documentElement.dataset.theme || "system");

themeButton?.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || "system";
  const next = order[(order.indexOf(current) + 1) % order.length];
  localStorage.setItem("bunyad-docs-theme", next);
  applyTheme(next);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if ((document.documentElement.dataset.theme || "system") === "system") {
    applyTheme("system");
  }
});

function setDrawer(open) {
  if (!drawer || !backdrop || !menuButton) return;
  drawer.hidden = !open;
  backdrop.hidden = !open;
  menuButton.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.style.overflow = open ? "hidden" : "";
  if (open) drawer.querySelector("a, button, summary")?.focus();
}

menuButton?.addEventListener("click", () => setDrawer(drawer?.hidden !== false));
closeDrawer?.addEventListener("click", () => setDrawer(false));
backdrop?.addEventListener("click", () => {
  setDrawer(false);
  versionMenu.hidden = true;
  versionButton?.setAttribute("aria-expanded", "false");
});

versionButton?.addEventListener("click", () => {
  const open = versionMenu.hasAttribute("hidden");
  versionMenu.toggleAttribute("hidden", !open);
  versionButton.setAttribute("aria-expanded", open ? "true" : "false");
});

document.addEventListener("keydown", (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if ((meta && event.key.toLowerCase() === "k") || event.key === "/") {
    const tag = document.activeElement?.tagName;
    if (event.key === "/" && (tag === "INPUT" || tag === "TEXTAREA")) return;
    event.preventDefault();
    openSearch();
  }
  if (event.key === "Escape") {
    setDrawer(false);
    if (dialog?.open) dialog.close();
  }
});

let indexPromise;
function loadIndex() {
  indexPromise ??= fetch("/assets/search-index.json").then((response) => response.json());
  return indexPromise;
}

function openSearch() {
  if (!dialog || !searchInput) return;
  dialog.showModal();
  searchInput.value = "";
  searchInput.focus();
  renderResults("");
}

searchButtons.forEach((button) => button.addEventListener("click", openSearch));

dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

let activeResult = 0;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function highlight(text, needle) {
  const safe = escapeHtml(text);
  if (!needle) return safe;
  const lower = safe.toLowerCase();
  const index = lower.indexOf(needle);
  if (index === -1) return safe;
  return (
    safe.slice(0, index) +
    `<mark>${safe.slice(index, index + needle.length)}</mark>` +
    safe.slice(index + needle.length)
  );
}

function headingList(page) {
  return (page.headings || []).map((heading) =>
    typeof heading === "string" ? { text: heading, id: "" } : heading,
  );
}

function collectHits(index, needle) {
  /** @type {Array<{ href: string, title: string, subtitle: string, kind: "page" | "heading", group: string }>} */
  const hits = [];

  for (const page of index) {
    const headings = headingList(page);
    const titleMatch = !needle || page.title.toLowerCase().includes(needle);
    const descriptionMatch = !needle || (page.description || "").toLowerCase().includes(needle);
    const group = page.group || "Docs";

    if (!needle || titleMatch || descriptionMatch) {
      hits.push({
        href: page.path,
        title: page.title,
        subtitle: page.description || group,
        kind: "page",
        group,
      });
    }

    if (!needle) continue;

    for (const heading of headings) {
      if (!heading.text.toLowerCase().includes(needle)) continue;
      if (!heading.id) continue;
      hits.push({
        href: `${page.path}#${heading.id}`,
        title: heading.text,
        subtitle: page.title,
        kind: "heading",
        group,
      });
    }
  }

  return hits.slice(0, 12);
}

function renderHit(hit, index, needle) {
  const icon = hit.kind === "heading" ? hashIcon : pageIcon;
  return `<button type="button" class="search-hit${index === 0 ? " is-active" : ""}" data-href="${escapeHtml(hit.href)}" role="option">
    <span class="search-hit-icon">${icon}</span>
    <span class="search-hit-body"><strong>${highlight(hit.title, needle)}</strong><span>${highlight(hit.subtitle, needle)}</span></span>
    <span class="search-hit-enter">${enterIcon}</span>
  </button>`;
}

function renderResults(query) {
  loadIndex().then((index) => {
    const needle = query.trim().toLowerCase();
    const hits = collectHits(index, needle);
    activeResult = 0;
    if (hits.length === 0) {
      searchResults.innerHTML = '<p class="search-empty">No matches</p>';
      return;
    }

    let html = "";
    let lastGroup = "";
    hits.forEach((hit, index) => {
      if (hit.group !== lastGroup) {
        lastGroup = hit.group;
        html += `<p class="search-group">${escapeHtml(hit.group)}</p>`;
      }
      html += renderHit(hit, index, needle);
    });
    searchResults.innerHTML = html;
  });
}

function goToHit(href) {
  if (!href) return;
  dialog?.close();
  const url = new URL(href, location.href);
  const samePage =
    url.pathname === location.pathname && url.search === location.search;
  if (samePage && url.hash) {
    location.hash = url.hash;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    target?.scrollIntoView({ block: "start" });
    spy();
    return;
  }
  location.href = href;
}

searchInput?.addEventListener("input", () => renderResults(searchInput.value));
searchInput?.addEventListener("keydown", (event) => {
  const hits = [...searchResults.querySelectorAll(".search-hit")];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    activeResult = event.key === "ArrowDown"
      ? Math.min(activeResult + 1, hits.length - 1)
      : Math.max(activeResult - 1, 0);
    hits.forEach((hit, index) => hit.classList.toggle("is-active", index === activeResult));
    hits[activeResult]?.scrollIntoView({ block: "nearest" });
  }
  if (event.key === "Enter") {
    event.preventDefault();
    goToHit(hits[activeResult]?.dataset.href);
  }
});
searchResults?.addEventListener("click", (event) => {
  const hit = event.target.closest(".search-hit");
  if (hit?.dataset.href) {
    event.preventDefault();
    goToHit(hit.dataset.href);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest(".copy");
  if (!button) return;
  const code = decodeURIComponent(button.dataset.code || "");
  await navigator.clipboard.writeText(code);
  const previous = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => {
    button.textContent = previous;
  }, 1200);
});

document.addEventListener("click", (event) => {
  const tab = event.target.closest(".tab");
  if (!tab) return;
  const group = tab.closest(".tabs");
  const index = Number(tab.dataset.tab);
  group.querySelectorAll(".tab").forEach((item) => {
    item.setAttribute("aria-selected", item === tab ? "true" : "false");
  });
  group.querySelectorAll(".tab-panel").forEach((panel, panelIndex) => {
    panel.hidden = panelIndex !== index;
  });
});

const tocLinks = [...document.querySelectorAll(".toc .toc-link")];
const headings = tocLinks
  .map((link) => document.getElementById(link.getAttribute("href").slice(1)))
  .filter(Boolean);

function spy() {
  if (headings.length === 0) return;
  let current = headings[0];
  for (const heading of headings) {
    if (heading.getBoundingClientRect().top < 96) current = heading;
  }
  tocLinks.forEach((link) => {
    link.classList.toggle("is-active", link.getAttribute("href") === `#${current.id}`);
  });
}

document.addEventListener("scroll", spy, { passive: true });
spy();

document.querySelector(".side-link.is-active")?.scrollIntoView({ block: "nearest" });
