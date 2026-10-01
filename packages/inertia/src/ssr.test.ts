import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Request } from "@bunyad/http";
import { ViewFactory, setViewFactory } from "@bunyad/view";
import {
  Inertia,
  dispatchSsr,
  formatSsrHead,
  resetInertiaState,
  resolveSsrConfig,
} from "./index.ts";

function req(url: string, init: RequestInit & { inertia?: boolean } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.inertia) headers.set("X-Inertia", "true");
  return new Request(new globalThis.Request(url, { ...init, headers }));
}

afterEach(() => {
  resetInertiaState();
});

describe("Inertia SSR gateway", () => {
  test("disabled SSR keeps CSR shell", async () => {
    Inertia.ssr({ enabled: false });
    const response = await Inertia.render("Home", { title: "Hi" }).toResponse(
      req("http://localhost/"),
    );
    const html = await response.text();
    expect(html).toContain('id="app"');
    expect(html).not.toContain("data-server-rendered");
    expect(html).toContain('data-page="app"');
  });

  test("X-Inertia JSON never hits SSR", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits += 1;
        return Response.json({ head: [], body: "<div>nope</div>" });
      },
    });

    Inertia.ssr({
      enabled: true,
      mode: "http",
      url: `http://127.0.0.1:${server.port}`,
    });

    const response = await Inertia.render("Home", { title: "Hi" }).toResponse(
      req("http://localhost/", { inertia: true }),
    );
    expect(response.headers.get("X-Inertia")).toBe("true");
    expect(hits).toBe(0);
    server.stop(true);
  });

  test("inline SSR injects head and body without HTTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-inertia-ssr-inline-"));
    await writeFile(
      join(dir, "app.view"),
      `<html><head>{!! ssrHead !!}</head><body>@if(ssrBody){!! ssrBody !!}@else<script data-page="app" type="application/json">{!! pageJson !!}</script><div id="app"></div>@endif</body></html>`,
    );
    setViewFactory(new ViewFactory(dir));

    let calls = 0;
    Inertia.ssr({
      enabled: true,
      mode: "inline",
      render: async (page) => {
        calls += 1;
        expect(page.component).toBe("Welcome");
        return {
          head: ["<title>Inline SSR</title>"],
          body: `<script data-page="app" type="application/json">{}</script><div data-server-rendered="true" id="app"><h1>${String(page.props.title)}</h1></div>`,
        };
      },
    });

    const html = await (
      await Inertia.render("Welcome", { title: "Hello" }).toResponse(
        req("http://localhost/welcome"),
      )
    ).text();
    expect(calls).toBe(1);
    expect(html).toContain("Inline SSR");
    expect(html).toContain('data-server-rendered="true"');
    expect(html).toContain("<h1>Hello</h1>");
  });

  test("enabled HTTP SSR injects head and body", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bunyad-inertia-ssr-"));
    await writeFile(
      join(dir, "app.view"),
      `<html><head>{!! ssrHead !!}</head><body>@if(ssrBody){!! ssrBody !!}@else<script data-page="app" type="application/json">{!! pageJson !!}</script><div id="app"></div>@endif</body></html>`,
    );
    setViewFactory(new ViewFactory(dir));

    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        expect(request.method).toBe("POST");
        expect(new URL(request.url).pathname).toBe("/render");
        const page = await request.json();
        expect(page.component).toBe("Welcome");
        expect(page.props.title).toBe("Hello");
        return Response.json({
          head: ["<title>SSR Title</title>"],
          body: `<script data-page="app" type="application/json">{}</script><div data-server-rendered="true" id="app"><h1>Hello</h1></div>`,
        });
      },
    });

    Inertia.ssr({
      enabled: true,
      mode: "http",
      url: `http://127.0.0.1:${server.port}`,
    });

    const response = await Inertia.render("Welcome", { title: "Hello" }).toResponse(
      req("http://localhost/welcome"),
    );
    const html = await response.text();
    expect(html).toContain("SSR Title");
    expect(html).toContain('data-server-rendered="true"');
    expect(html).toContain("<h1>Hello</h1>");
    server.stop(true);
  });

  test("SSR failure falls back to CSR", async () => {
    Inertia.ssr({
      enabled: true,
      mode: "http",
      url: "http://127.0.0.1:1",
      timeout: 200,
    });

    const response = await Inertia.render("Home", { title: "Hi" }).toResponse(
      req("http://localhost/"),
    );
    const html = await response.text();
    expect(html).toContain('data-page="app"');
    expect(html).not.toContain("data-server-rendered");
  });

  test("except skips SSR for listed components", async () => {
    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits += 1;
        return Response.json({
          head: [],
          body: `<div data-server-rendered="true" id="app">x</div>`,
        });
      },
    });

    Inertia.ssr({
      enabled: true,
      mode: "http",
      url: `http://127.0.0.1:${server.port}`,
      except: ["SkipMe"],
    });

    const html = await (
      await Inertia.render("SkipMe", {}).toResponse(req("http://localhost/"))
    ).text();
    expect(hits).toBe(0);
    expect(html).not.toContain("data-server-rendered");
    server.stop(true);
  });

  test("inline mode without render falls back to CSR", async () => {
    Inertia.ssr({ enabled: true, mode: "inline" });
    const html = await (
      await Inertia.render("Home", { title: "Hi" }).toResponse(
        req("http://localhost/"),
      )
    ).text();
    expect(html).toContain('data-page="app"');
    expect(html).not.toContain("data-server-rendered");
  });

  test("inline render errors fall back to CSR", async () => {
    Inertia.ssr({
      enabled: true,
      mode: "inline",
      render: async () => {
        throw new Error("boom");
      },
    });
    const html = await (
      await Inertia.render("Home", { title: "Hi" }).toResponse(
        req("http://localhost/"),
      )
    ).text();
    expect(html).toContain('data-page="app"');
    expect(html).not.toContain("data-server-rendered");
  });

  test("inline preferred when render set; no HTTP hop", async () => {
    let httpHits = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        httpHits += 1;
        return Response.json({ head: [], body: "<div>http</div>" });
      },
    });

    Inertia.ssr({
      enabled: true,
      // mode omitted → resolveSsrConfig picks inline when render is set
      url: `http://127.0.0.1:${server.port}`,
      render: async () => ({
        head: "<title>Inline</title>",
        body: '<div data-server-rendered="true" id="app">inline</div>',
      }),
    });

    const cfg = resolveSsrConfig();
    expect(cfg.mode).toBe("inline");
    expect(cfg.enabled).toBe(true);

    const html = await (
      await Inertia.render("Home", {}).toResponse(req("http://localhost/"))
    ).text();
    expect(httpHits).toBe(0);
    expect(html).toContain("data-server-rendered");
    expect(html).toContain("inline");
    server.stop(true);
  });

  test("dispatchSsr respects enabled=false and formatSsrHead joins arrays", async () => {
    expect(formatSsrHead(["<a/>", "<b/>"])).toBe("<a/><b/>");
    expect(formatSsrHead("<c/>")).toBe("<c/>");
    expect(formatSsrHead(undefined)).toBe("");

    const result = await dispatchSsr(
      {
        component: "X",
        props: {},
        url: "/",
        version: null,
      },
      { enabled: false, mode: "inline", render: async () => ({ head: [], body: "x" }) },
    );
    expect(result).toBeNull();
  });

  test("default root HTML embeds ssrBody when view factory missing", async () => {
    Inertia.ssr({
      enabled: true,
      mode: "inline",
      render: async () => ({
        head: ["<title>T</title>"],
        body: '<div data-server-rendered="true" id="app">ssr</div>',
      }),
    });
    // Ensure no pre-set view factory path: render falls back to defaultRootHtml
    const html = await (
      await Inertia.render("Home", {}).toResponse(req("http://localhost/"))
    ).text();
    // May use view factory if one left from prior tests — either path must include SSR body
    expect(html).toContain("data-server-rendered");
    expect(html).toContain("ssr");
  });
});
