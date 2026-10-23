import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createInertiaApp } from "@inertiajs/react";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import type { InertiaPage, SsrRenderResult } from "@bunyad/inertia";

const tree = resolve(import.meta.dir, "../../routes");

/** The `*Layout.tsx` of each folder from `routes/` down to the page, outermost first (one per folder). */
function layoutFiles(name: string): string[] {
  const parts = name.split("/").slice(0, -1);
  const found: string[] = [];
  for (let i = 0; i <= parts.length; i++) {
    const dir = resolve(tree, ...parts.slice(0, i));
    const layout = readdirSync(dir).find((entry) => /Layout\.tsx$/.test(entry));
    if (layout) found.push(resolve(dir, layout));
  }
  return found;
}

/** A page wrapped in its layouts, the way the browser entry does it (`bunyad build`). */
async function loadPage(name: string) {
  const mod = await import(`${tree}/${name}.tsx`);
  const Page = mod.default as any;
  const layouts = await Promise.all(layoutFiles(name).map((file) => import(file)));
  const chain = layouts.slice(Math.max(layouts.map((layout) => layout.reset === true).lastIndexOf(true), 0)).map((layout) => layout.default);
  if (Page.layout === undefined && chain.length > 0) {
    Page.layout = (element: any) => {
      const meta = typeof mod.meta === "function" ? mod.meta(element.props) : (mod.meta ?? {});
      return chain.reduceRight((children: unknown, Layout: any) => createElement(Layout, { meta }, children), element);
    };
  }
  return Page;
}

/**
 * In-process Inertia SSR renderer (no separate port), shared with the optional HTTP worker.
 * Pages load straight from their folders under `routes`; the browser bundle is not used.
 */
export async function renderInertiaPage(page: InertiaPage): Promise<SsrRenderResult> {
  return createInertiaApp({
    page: page as never,
    render: renderToString,
    resolve: async (name) => loadPage(name),
    setup: ({ App, props }): ReactElement => <App {...props} />,
    serverHead: true,
  });
}
