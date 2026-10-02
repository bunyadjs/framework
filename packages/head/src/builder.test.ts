import { beforeEach, describe, expect, test } from "bun:test";
import { Request } from "@bunyad/http";
import {
  Head,
  HeadBuilder,
  HeadManager,
  getHeadManager,
  handleHead,
  runWithHead,
  setHeadManager,
  shareHeadWithInertia,
} from "./index.ts";

beforeEach(() => {
  setHeadManager(new HeadManager());
});

const resolve = (...builders: HeadBuilder[]) =>
  HeadBuilder.merge(builders.map((b) => b.layer()));

describe("escaping", () => {
  test("title text escapes markup and ampersands", () => {
    runWithHead(() => {
      Head.title("</title><script>alert(1)</script> & co");
      const html = Head.toHtml();
      expect(html).toContain(
        "&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</title>",
      );
      expect(html).not.toContain("<script>");
    });
  });

  test("attribute values cannot break out of their quotes", () => {
    runWithHead(() => {
      Head.description('"><script>x</script>');
      Head.og({ siteName: 'A "quoted" <name>' });
      Head.canonical('https://x.test/?a="1"&b=<2>');
      Head.meta({ name: 'n"x', content: 'c"y' });
      Head.link({ rel: "alternate", href: '/feed"onload="x', type: 'a"b', sizes: '1"2' });
      const html = Head.toHtml();
      expect(html).toContain('content="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
      expect(html).toContain('content="A &quot;quoted&quot; &lt;name&gt;"');
      expect(html).toContain('href="https://x.test/?a=&quot;1&quot;&amp;b=&lt;2&gt;"');
      expect(html).toContain('name="n&quot;x" content="c&quot;y"');
      expect(html).toContain('href="/feed&quot;onload=&quot;x"');
      expect(html).not.toContain("<script>");
    });
  });

  test("the inertia ownership key is escaped too", () => {
    runWithHead(() => {
      Head.meta({ name: "x", content: "1" }, 'k"><b>');
      expect(Head.toHtml()).toContain('data-inertia="k&quot;&gt;&lt;b&gt;"');
    });
  });

  test("preload escapes href/as/type, while tag() is emitted verbatim by design", () => {
    const b = new HeadBuilder().preload('/a"b.css', { as: 'sty"le', type: "text/css" }).tag("<noscript>raw</noscript>");
    const resolved = resolve(b);
    const html = HeadBuilder.toElements(resolved).map((e) => e.html);
    expect(html[0]).toBe('<link rel="preload" href="/a&quot;b.css" as="sty&quot;le" type="text/css">');
    expect(html[1]).toBe("<noscript>raw</noscript>");
  });

  test("numeric image sizes are rendered as attributes", () => {
    const resolved = resolve(new HeadBuilder().ogImage("/i.png", { width: 1200, height: 630 }));
    const html = HeadBuilder.toElements(resolved).map((e) => e.html).join("\n");
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
  });
});

describe("title merging", () => {
  test("prefix and suffix from an earlier layer apply to a later bare title", () => {
    const defaults = new HeadBuilder().title("Site", { prefix: "» ", suffix: " | Site" });
    const page = new HeadBuilder().title("Docs");
    expect(resolve(defaults, page).title).toBe("» Docs | Site");
  });

  test("a page can override just the suffix and keep the inherited prefix", () => {
    const defaults = new HeadBuilder().title("Site", { prefix: "» ", suffix: " | Site" });
    const page = new HeadBuilder().title("Docs", { suffix: "!" });
    expect(resolve(defaults, page).title).toBe("» Docs!");
  });

  test("an empty suffix removes the inherited one", () => {
    const defaults = new HeadBuilder().title("Site", { suffix: " | Site" });
    const page = new HeadBuilder().title("Docs", { suffix: "" });
    expect(resolve(defaults, page).title).toBe("Docs");
  });

  test("exact ignores both prefix and suffix", () => {
    const defaults = new HeadBuilder().title("Site", { prefix: "> ", suffix: " <" });
    const page = new HeadBuilder().title("Raw", { exact: true });
    expect(resolve(defaults, page).title).toBe("Raw");
  });

  test("no title anywhere leaves title and og:title unset", () => {
    const resolved = resolve(new HeadBuilder().description("d"));
    expect(resolved.title).toBeUndefined();
    expect(resolved.og["og:title"]).toBeUndefined();
    expect(resolved.og["og:description"]).toBe("d");
  });

  test("a later layer's title wins even if the earlier one set options on it", () => {
    const first = new HeadBuilder().title("One", { exact: true });
    const second = new HeadBuilder().title("Two", { suffix: "!" });
    expect(resolve(first, second).title).toBe("Two!");
  });
});

describe("open graph", () => {
  test("og:title, og:description and og:url are derived but explicit values win", () => {
    const derived = HeadBuilder.merge(
      [new HeadBuilder().title("T", { suffix: "!" }).description("D").canonical("/p").layer()],
      "https://s.test/x",
    );
    expect(derived.og).toEqual({
      "og:description": "D",
      "og:title": "T!",
      "og:url": "https://s.test/p",
    });

    const explicit = HeadBuilder.merge(
      [
        new HeadBuilder()
          .title("T")
          .description("D")
          .canonical("/p")
          .og({ title: "OG T", description: "OG D", url: "https://other.test/", type: "website", locale: "en_GB" })
          .layer(),
      ],
      "https://s.test/x",
    );
    expect(explicit.og["og:title"]).toBe("OG T");
    expect(explicit.og["og:description"]).toBe("OG D");
    expect(explicit.og["og:url"]).toBe("https://other.test/");
    expect(explicit.og["og:locale"]).toBe("en_GB");
  });

  test("og options accumulate across calls and layers", () => {
    const a = new HeadBuilder().og({ siteName: "Site" }).og({ type: "website" });
    const b = new HeadBuilder().og({ type: "article" });
    expect(resolve(a, b).og).toEqual({ "og:site_name": "Site", "og:type": "article" });
  });

  test("ogImage dedupes by url within a layer; a later layer replaces earlier images entirely", () => {
    const a = new HeadBuilder().ogImage("/a.png", { alt: "old" }).ogImage("/a.png", { alt: "new" }).ogImage("/b.png");
    expect(resolve(a).images).toEqual([{ url: "/a.png", alt: "new" }, { url: "/b.png" }]);
    const b = new HeadBuilder().ogImage("/c.png");
    expect(resolve(a, b).images).toEqual([{ url: "/c.png" }]);
  });

  test("image sub-tags follow the image tag and are keyed per image index", () => {
    const resolved = resolve(
      new HeadBuilder().ogImage("/a.png", { alt: "A", type: "image/png" }).ogImage("/b.png"),
    );
    const keys = HeadBuilder.toElements(resolved).map((e) => e.key);
    expect(keys).toEqual(["og:image:0", "og:image:0:alt", "og:image:0:type", "og:image:1"]);
  });
});

describe("canonical", () => {
  const canonical = (value: string | true | undefined, requestUrl?: string, options?: { forceHttps?: boolean }) => {
    const b = new HeadBuilder();
    if (value !== undefined) b.canonical(value, options);
    return HeadBuilder.merge([b.layer()], requestUrl).canonical;
  };

  test("true uses the request url and upgrades http to https", () => {
    expect(canonical(true, "http://a.test/p?x=1")).toBe("https://a.test/p?x=1");
  });

  test("forceHttps: false keeps http", () => {
    expect(canonical(true, "http://a.test/p", { forceHttps: false })).toBe("http://a.test/p");
  });

  test("relative values resolve against the request url; absolute values are kept", () => {
    expect(canonical("/other", "https://a.test/deep/page")).toBe("https://a.test/other");
    expect(canonical("sibling", "https://a.test/deep/page")).toBe("https://a.test/deep/sibling");
    expect(canonical("https://b.test/x", "https://a.test/")).toBe("https://b.test/x");
    expect(canonical("http://b.test/x", "https://a.test/")).toBe("https://b.test/x");
  });

  test("without a request url: true falls back to '/', a relative value stays as written", () => {
    expect(canonical(true)).toBe("/");
    expect(canonical("/only-path")).toBe("/only-path");
  });

  test("no canonical call means no canonical tag and no og:url", () => {
    const resolved = HeadBuilder.merge([new HeadBuilder().title("x").layer()], "https://a.test/");
    expect(resolved.canonical).toBeUndefined();
    expect(resolved.og["og:url"]).toBeUndefined();
  });

  test("a relative path that merely starts with 'http' is resolved against the request url", () => {
    expect(canonical("http-guide", "https://a.test/docs/page")).toBe("https://a.test/docs/http-guide");
  });
});

describe("robots, meta, links", () => {
  test("robots accepts arrays and the last layer wins", () => {
    expect(resolve(new HeadBuilder().robots(["noindex", "nofollow"])).robots).toBe("noindex, nofollow");
    expect(
      resolve(new HeadBuilder().hiddenFromRobots(), new HeadBuilder().searchableByRobots()).robots,
    ).toBe("all");
  });

  test("meta defaults its key to name, then property, then a positional key", () => {
    const b = new HeadBuilder()
      .meta({ name: "author", content: "a" })
      .meta({ property: "article:tag", content: "t" })
      .meta({ content: "anon" });
    expect(b.layer().meta?.map((m) => m.key)).toEqual(["author", "article:tag", "meta-2"]);
  });

  test("the same meta key replaces in place, across layers too", () => {
    const a = new HeadBuilder().meta({ name: "author", content: "a" }).meta({ name: "x", content: "1" });
    const b = new HeadBuilder().meta({ name: "author", content: "b" });
    const resolved = resolve(a, b);
    expect(resolved.meta.map((m) => [m.key, m.content])).toEqual([["author", "b"], ["x", "1"]]);
  });

  test("helper tags: viewport, colour scheme, theme colour, application name", () => {
    const html = HeadBuilder.toElements(
      resolve(
        new HeadBuilder()
          .viewport("width=device-width")
          .colorScheme("light dark")
          .themeColor("#fff")
          .applicationName("App"),
      ),
      { inertiaOwned: false },
    ).map((e) => e.html);
    expect(html).toEqual([
      '<meta name="viewport" content="width=device-width">',
      '<meta name="color-scheme" content="light dark">',
      '<meta name="application-name" content="App">',
      '<meta name="theme-color" content="#fff">',
    ]);
  });

  test("icons and manifest become keyed links; a later icon replaces an earlier one", () => {
    const resolved = resolve(
      new HeadBuilder().icon("/a.ico").manifest("/m.json"),
      new HeadBuilder().icon("/b.svg", { type: "image/svg+xml" }).appleTouchIcon("/t.png", { sizes: "180x180" }),
    );
    expect(resolved.links.map((l) => [l.key, l.href])).toEqual([
      ["icon", "/b.svg"],
      ["manifest", "/m.json"],
      ["apple-touch-icon", "/t.png"],
    ]);
    const html = HeadBuilder.toElements(resolved, { inertiaOwned: false }).map((e) => e.html);
    expect(html[0]).toBe('<link rel="icon" href="/b.svg" type="image/svg+xml">');
    expect(html[2]).toBe('<link rel="apple-touch-icon" href="/t.png" sizes="180x180">');
  });

  test("resource hint helpers use distinct keys per kind and href", () => {
    const b = new HeadBuilder()
      .preconnect("https://cdn.test")
      .dnsPrefetch("https://cdn.test")
      .prefetch("/next")
      .preconnect("https://cdn.test");
    expect(b.layer().links?.map((l) => l.key)).toEqual([
      "preconnect:https://cdn.test",
      "dns-prefetch:https://cdn.test",
      "prefetch:/next",
    ]);
  });

  test("custom tags with the same key replace each other", () => {
    const a = new HeadBuilder().tag("<style>a</style>", "css");
    const b = new HeadBuilder().tag("<style>b</style>", "css");
    expect(resolve(a, b).customs).toEqual([{ key: "css", html: "<style>b</style>" }]);
  });

  test("when/unless with falsy-but-defined values", () => {
    const seen: string[] = [];
    new HeadBuilder()
      .when(0, () => seen.push("when 0"))
      .when("x", () => seen.push("when x"))
      .unless("", () => seen.push("unless ''"))
      .unless([], () => seen.push("unless []"));
    expect(seen).toEqual(["when x", "unless ''"]);
  });
});

describe("element output", () => {
  test("elements come out in a fixed order regardless of call order", () => {
    const b = new HeadBuilder()
      .tag("<x>", "x")
      .link({ rel: "alternate", href: "/rss" })
      .meta({ name: "a", content: "1" })
      .ogImage("/i.png")
      .robots("all")
      .canonical("/c")
      .description("d")
      .title("t");
    const keys = HeadBuilder.toElements(HeadBuilder.merge([b.layer()], "https://s.test/")).map((e) => e.key);
    expect(keys).toEqual([
      "title",
      "description",
      "canonical",
      "robots",
      "og:description",
      "og:title",
      "og:url",
      "og:image:0",
      "a",
      "alternate:/rss",
      "x",
    ]);
  });

  test("inertiaOwned toggles data-inertia attributes but never touches custom tags", () => {
    const resolved = resolve(new HeadBuilder().title("t").tag("<x>", "x"));
    const owned = HeadBuilder.toElements(resolved, { inertiaOwned: true }).map((e) => e.html);
    const plain = HeadBuilder.toElements(resolved, { inertiaOwned: false }).map((e) => e.html);
    expect(owned[0]).toBe('<title data-inertia="title">t</title>');
    expect(plain[0]).toBe("<title>t</title>");
    expect(owned.at(-1)).toBe("<x>");
    expect(plain.at(-1)).toBe("<x>");
  });

  test("an empty builder renders nothing", () => {
    expect(HeadBuilder.toElements(resolve(new HeadBuilder()))).toEqual([]);
  });
});

describe("layer ordering in HeadManager", () => {
  test("defaults < route < runtime < error, and multiple defaults apply in registration order", () => {
    const manager = new HeadManager();
    setHeadManager(manager);
    manager.defaults((h) => h.description("default-1").title("D1"));
    manager.defaults((h) => h.description("default-2"));
    runWithHead(() => {
      manager.applyRoute((h) => h.title("Route", { suffix: " (route)" }).robots("noindex"));
      manager.applyRoute((h) => h.robots("nofollow"));
      manager.runtime().title("Runtime");
      expect(manager.resolve().title).toBe("Runtime (route)");
      expect(manager.resolve().description).toBe("default-2");
      expect(manager.resolve().robots).toBe("nofollow");
      manager.applyError((h) => h.title("Not found", { exact: true }).robots("none"));
      expect(manager.resolve().title).toBe("Not found");
      expect(manager.resolve().robots).toBe("none");
      // a second error replaces the first rather than stacking
      manager.applyError((h) => h.description("err"));
      expect(manager.resolve().title).toBe("Runtime (route)");
      expect(manager.resolve().robots).toBe("nofollow");
    });
  });

  test("defaults callbacks run fresh on every resolve, so they can read request-time state", () => {
    let n = 0;
    const manager = new HeadManager().defaults((h) => h.description(`call ${++n}`));
    setHeadManager(manager);
    runWithHead(() => {
      expect(manager.resolve().description).toBe("call 1");
      expect(manager.resolve().description).toBe("call 2");
    });
  });

  test("an explicit url argument overrides the request url", () => {
    const manager = new HeadManager().defaults((h) => h.canonical());
    setHeadManager(manager);
    runWithHead(() => {
      expect(manager.resolve().canonical).toBe("https://a.test/one");
      expect(manager.resolve("https://a.test/two").canonical).toBe("https://a.test/two");
    }, { url: "https://a.test/one" });
  });

  test("inertia globals render first, are not owned, and ignore page layers", () => {
    Head.inertiaGlobals((h) => h.viewport("v").description("Global description"));
    runWithHead(() => {
      Head.title("Page");
      const lines = Head.toHtml().split("\n");
      expect(lines[0]).toBe('<meta name="description" content="Global description">');
      expect(lines).toContain('<meta name="viewport" content="v">');
      // page tags come after every global and carry ownership attributes
      expect(lines.findIndex((l) => l.includes("<title"))).toBeGreaterThan(lines.indexOf('<meta name="viewport" content="v">'));
      expect(lines).toContain('<title data-inertia="title">Page</title>');
      expect(lines.filter((l) => !l.includes("data-inertia")).length).toBe(3); // description, og:description (derived), viewport
    });
  });
});

describe("request isolation", () => {
  test("concurrent requests do not see each other's runtime head", async () => {
    Head.defaults((h) => h.title("Base", { suffix: " - S" }));
    const render = (name: string, delay: number) =>
      runWithHead(async () => {
        Head.title(name);
        await new Promise((r) => setTimeout(r, delay));
        return Head.toHtml();
      });
    const [a, b] = await Promise.all([render("A", 15), render("B", 1)]);
    expect(a).toContain(">A - S</title>");
    expect(a).not.toContain("B - S");
    expect(b).toContain(">B - S</title>");
  });

  test("state set inside a request is gone afterwards", () => {
    runWithHead(() => Head.title("inside"));
    expect(Head.toHtml()).toBe("");
  });

  test("handleHead gives each request a fresh runtime builder and its own url", async () => {
    Head.defaults((h) => h.canonical());
    const mw = handleHead();
    const run = (url: string, title: string) =>
      mw.handle(new Request(new globalThis.Request(url)), async () => {
        Head.title(title);
        return new Response(Head.toHtml());
      });
    const [one, two] = await Promise.all([run("https://app.test/1", "One"), run("https://app.test/2", "Two")]);
    const html1 = await one.text();
    const html2 = await two.text();
    expect(html1).toContain("https://app.test/1");
    expect(html1).not.toContain("Two");
    expect(html2).toContain("https://app.test/2");
    expect(getHeadManager().url()).toBeUndefined();
  });
});

describe("inertia integration", () => {
  test("custom prop name is shared, and partial reloads receive undefined", async () => {
    Head.inertia({ prop: "seo" });
    const shared: Record<string, (r: Request) => unknown> = {};
    shareHeadWithInertia((key, value) => {
      shared[key] = value as never;
    });
    expect(Object.keys(shared)).toEqual(["seo"]);

    const full = new Request(new globalThis.Request("https://app.test/p"));
    const partial = new Request(
      new globalThis.Request("https://app.test/p", { headers: { "x-inertia-partial-component": "Page" } }),
    );
    await runWithHead(async () => {
      Head.title("T");
      expect(shared.seo!(full)).toEqual(['<title data-inertia="title">T</title>', '<meta data-inertia="og:title" property="og:title" content="T">']);
      expect(shared.seo!(partial)).toBeUndefined();
    }, { url: "https://app.test/p" });
  });

  test("inertia() keeps unspecified options and flush() restores defaults", () => {
    const manager = getHeadManager();
    manager.inertia({ prop: "meta" });
    manager.inertia({ enabled: false });
    expect(manager.inertiaProp()).toBe("meta");
    expect(manager.inertiaEnabled()).toBe(false);
    manager.flush();
    expect(manager.inertiaProp()).toBe("head");
    expect(manager.inertiaEnabled()).toBe(true);
  });
});
