import { describe, expect, test } from "bun:test";
import { extractHeadings, parseFrontmatter, renderMarkdown, slugify, wrapTables } from "../app/Docs/markdown.ts";
import { flatPages } from "../app/Docs/nav.ts";
import { searchIndex, type BuiltPage } from "../app/Docs/site.ts";
import DocsController from "../app/Http/Controllers/DocsController.ts";
import { warm } from "../app/Docs/cache.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("heading slugs match GitHub style", () => {
  expect(slugify("Route parameters")).toBe("route-parameters");
  expect(slugify("When debug is off")).toBe("when-debug-is-off");
});

test("frontmatter requires a body after the closing fence", () => {
  const parsed = parseFrontmatter("---\ntitle: Routing\ndescription: Routes.\n---\n# Routing\n");
  expect(parsed.meta.title).toBe("Routing");
  expect(parsed.body).toContain("# Routing");
});

test("headings skip fenced code", () => {
  const headings = extractHeadings("# Title\n\n```ts\n## not a heading\n```\n\n## Real\n");
  expect(headings.map((heading) => heading.text)).toEqual(["Real"]);
});

test("markdown renders callouts and highlighted code", async () => {
  const rendered = await renderMarkdown(
    "## Ports\n\n:::note\nKeep debug off.\n:::\n\n```ts title=\"config/app.ts\"\nexport const port = 3000;\n```\n",
  );
  expect(rendered.headings[0]?.id).toBe("ports");
  expect(rendered.html).toContain("callout-note");
  expect(rendered.html).toContain("config/app.ts");
  expect(rendered.html).toContain("shiki");
});

test("tables scroll inside their own box so a wide one cannot widen the page", async () => {
  const table = "| Option | Default |\n| --- | --- |\n| `storagePath` | `storage/debugbar` |\n";
  const rendered = await renderMarkdown(`${table}\nText between.\n\n${table}`);
  expect(rendered.html.match(/<div class="table-wrap" tabindex="0"><table>/g)).toHaveLength(2);
  expect(rendered.html.match(/<\/table><\/div>/g)).toHaveLength(2);
  // a table inside a callout is wrapped too
  const inCallout = await renderMarkdown(`:::note\n${table}:::\n`);
  expect(inCallout.html).toContain('class="table-wrap"');
  // wrapping again changes nothing
  const once = wrapTables("<p>x</p><table><tr><td>x</td></tr></table>");
  expect(wrapTables(once)).toBe(once);
  expect(once.match(/table-wrap/g)).toHaveLength(1);
});

test("code lines are not display:block, because the highlighter separates lines with a newline", async () => {
  // Shiki emits `<span class="line">a</span>\n<span class="line">b</span>`. Inside a <pre>, a newline
  // between two block-level lines renders as an empty row, which doubled the spacing of every sample.
  const { html } = await renderMarkdown("```ts\nconst a = 1;\nconst b = 2;\n```\n");
  expect(html).toContain('</span>\n<span class="line">');

  const css = readFileSync(join(import.meta.dir, "../public/assets/styles.css"), "utf8");
  const rule = css.match(/\.shiki \.line\s*\{[^}]*\}/)?.[0] ?? "";
  expect(rule).not.toBe("");
  expect(rule).not.toMatch(/display:\s*block/);
});

test("search index includes heading anchors", () => {
  const pages = [
    {
      slug: "routing",
      title: "Routing",
      description: "Declare routes.",
      group: "The Basics",
      path: "/docs/1.x/routing",
      headings: [
        { level: 2 as const, text: "Route Model Binding", id: "route-model-binding" },
      ],
      html: "",
      markdown: "",
    } satisfies BuiltPage,
  ];
  const index = searchIndex(pages);
  expect(index[0]?.headings).toEqual([
    { text: "Route Model Binding", id: "route-model-binding" },
  ]);
  expect(index[0]?.group).toBe("The Basics");
});

describe("published pages", () => {
  test("every sidebar page has a content file", () => {
    for (const page of flatPages()) {
      expect(existsSync(join(import.meta.dir, "../resources/docs/1.x", page.file))).toBe(true);
    }
  });
});

describe("site root", () => {
  test("/ serves the Introduction directly instead of redirecting", async () => {
    await warm();
    const controller = new DocsController();
    const home = await controller.home();
    const intro = await controller.index();
    expect(home.status).toBe(200);
    expect(home.headers.get("location")).toBeNull();
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(await home.text()).toBe(await intro.text());
  });
});
