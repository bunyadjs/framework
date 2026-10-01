import { describe, expect, test } from "bun:test";
import { extractHeadings, parseFrontmatter, renderMarkdown, slugify } from "../app/Docs/markdown.ts";
import { flatPages } from "../app/Docs/nav.ts";
import { searchIndex, type BuiltPage } from "../app/Docs/site.ts";
import { existsSync } from "node:fs";
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
