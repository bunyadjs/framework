import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { setErrorPageRenderer, type Application } from "@bunyad/core";
import { isResponsable } from "@bunyad/contracts";
import { pageName, pageResponderFor } from "@bunyad/router";

const EXTENSIONS = [".tsx", ".jsx", ".vue", ".svelte", ".view"];

/** Page file for each status: `NotFoundPage` (404), `ForbiddenPage` (403), `ExpiredPage` (419), `ErrorPage` (the rest). */
const NAMES: Record<string, string> = { 403: "ForbiddenPage", 404: "NotFoundPage", 419: "ExpiredPage" };

/**
 * Browsers get the app's own error pages: `NotFoundPage.tsx` (or `.vue`, `.svelte`, `.view`) at the root
 * of `routes/` renders for a 404 inside the root layout, with `status` and `message` as props. `ErrorPage`
 * answers every other error status. Without these files the built-in pages are used.
 */
export function registerErrorPages(app: Application): void {
  const tree = join(app.basePath(), "routes");
  const find = (name: string): string | undefined => {
    for (const ext of EXTENSIONS) {
      const file = join(tree, `${name}${ext}`);
      if (existsSync(file)) return file;
    }
    return undefined;
  };
  const pages = new Map<string, string>();
  for (const name of new Set([...Object.values(NAMES), "ErrorPage"])) {
    const file = find(name);
    if (file) pages.set(name, file);
  }
  if (pages.size === 0) return;

  setErrorPageRenderer(async (status, request, error) => {
    const file = pages.get(NAMES[status] ?? "") ?? pages.get("ErrorPage");
    if (!file) return undefined;
    const path = relative(app.basePath(), file);
    const responder = pageResponderFor(file);
    if (!responder) return undefined;
    const message = error instanceof Error ? error.message : "";
    const result = await responder({ file: path, name: pageName(path) }, { status, message }, request);
    if (result instanceof Response) return result;
    if (isResponsable(result)) return await result.toResponse(request as never);
    return undefined;
  });
}
