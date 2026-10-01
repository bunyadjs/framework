import { expect, test } from "bun:test";
import {
  injectReloadScript,
  isHtmlResponse,
  defaultRefreshRoots,
  createDevReloadHandler,
  formatReloadLog,
  reloadModeForFiles,
} from "../src/dev-reload.ts";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("isHtmlResponse detects html content-type", () => {
  expect(
    isHtmlResponse(
      new Response("<html></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    ),
  ).toBe(true);
  expect(
    isHtmlResponse(
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    ),
  ).toBe(false);
});

test("injectReloadScript appends client script before body close", async () => {
  const input = new Response(
    `<!DOCTYPE html><html><body><h1>Hi</h1></body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
  const out = await injectReloadScript(input);
  const html = await out.text();
  expect(html).toContain("/__bunyad/reload.js");
  expect(html).toContain("<h1>Hi</h1>");
});

test("defaultRefreshRoots points at views routes app and public/build", () => {
  const roots = defaultRefreshRoots("/tmp/app");
  expect(roots.some((r) => r.endsWith("resources/views"))).toBe(true);
  expect(roots.some((r) => r.endsWith("public/build"))).toBe(true);
  expect(roots.some((r) => r.endsWith("routes"))).toBe(true);
  expect(roots.some((r) => r.endsWith("app"))).toBe(true);
  expect(roots.some((r) => r.endsWith("resources/js"))).toBe(false);
});

test("dev reload handler serves client script and sse", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunyad-reload-"));
  await mkdir(join(dir, "views"), { recursive: true });
  const handler = createDevReloadHandler({ roots: [join(dir, "views")] });

  const js = handler.match("/__bunyad/reload.js");
  expect(js?.status).toBe(200);
  const clientScript = await js!.text();
  expect(clientScript).toContain("EventSource");
  expect(clientScript).toContain("reloadOnReconnect");
  expect(clientScript).toContain("bunyad:morph");
  expect(clientScript).toContain('mode === "morph"');
  expect(clientScript).toContain("pagehide");

  const sse = handler.match("/__bunyad/reload");
  expect(sse?.headers.get("content-type")).toContain("text/event-stream");

  const trigger = handler.match(
    "/__bunyad/reload",
    new Request("http://localhost/__bunyad/reload", { method: "POST" }),
  );
  expect(trigger?.status).toBe(200);
  expect(await trigger!.text()).toBe("ok");

  expect(handler.match("/other")).toBeNull();

  // Touch a watched file — should not throw
  await writeFile(join(dir, "views", "x.view"), "hi");
  await Bun.sleep(100);

  handler.stop();
  sse?.body?.cancel();
});

test("formatReloadLog matches Vite-style page reload line", () => {
  const line = formatReloadLog("resources/views/welcome.view");
  expect(line).toContain("[bunyad]");
  expect(line).toContain("page reload resources/views/welcome.view");
});

test("formatReloadLog uses html update for morph mode", () => {
  const line = formatReloadLog("resources/views/welcome.view", "morph");
  expect(line).toContain("html update resources/views/welcome.view");
});

test("reloadModeForFiles morphs view-only changes", () => {
  expect(reloadModeForFiles(["resources/views/home.view"])).toBe("morph");
  expect(
    reloadModeForFiles(["resources/views/a.view", "resources/views/b.view"]),
  ).toBe("morph");
  expect(reloadModeForFiles(["app/Http/Kernel.ts"])).toBe("full");
  expect(
    reloadModeForFiles(["resources/views/home.view", "public/build/app.js"]),
  ).toBe("full");
  expect(reloadModeForFiles([])).toBe("full");
});
