import { expect, test, beforeEach } from "bun:test";
import { Request } from "@bunyad/http";
import {
  Head,
  HeadBuilder,
  getHeadManager,
  handleHead,
  runWithHead,
  setHeadManager,
  shareHeadWithInertia,
  HeadManager,
} from "../src/index.ts";

beforeEach(() => {
  setHeadManager(new HeadManager());
});

test("defaults + runtime title with inherited suffix", () => {
  Head.defaults((head) => {
    head.title("Bunyad", { suffix: " - Bunyad" }).description("Build apps.");
  });

  runWithHead(() => {
    Head.title("About");
    const html = Head.toHtml();
    expect(html).toContain("<title data-inertia=\"title\">About - Bunyad</title>");
    expect(html).toContain('name="description" content="Build apps."');
  });
});

test("exact title ignores suffix", () => {
  Head.defaults((head) => {
    head.title("Bunyad", { suffix: " - Bunyad" });
  });

  runWithHead(() => {
    Head.title("Status", { exact: true });
    expect(Head.toHtml()).toContain(">Status</title>");
    expect(Head.toHtml()).not.toContain("Status - Bunyad");
  });
});

test("runtime overrides description without clearing title defaults", () => {
  Head.defaults((head) => {
    head.title("Home", { suffix: " - App" }).description("Default");
  });

  runWithHead(() => {
    Head.description("Override");
    const resolved = Head.toArray();
    expect(resolved.title).toBe("Home - App");
    expect(resolved.description).toBe("Override");
  });
});

test("canonical from request url", () => {
  Head.defaults((head) => {
    head.canonical();
  });

  runWithHead(
    () => {
      const html = Head.toHtml();
      expect(html).toContain('rel="canonical" href="https://example.com/posts/1"');
    },
    { url: "http://example.com/posts/1" },
  );
});

test("og and robots helpers", () => {
  runWithHead(() => {
    Head.title("Post")
      .description("Hello")
      .og({ type: "article", siteName: "Bunyad" })
      .ogImage("/cover.jpg", { width: 1200, height: 630, alt: "Cover" })
      .searchableByRobots();

    const html = Head.toHtml();
    expect(html).toContain('property="og:type" content="article"');
    expect(html).toContain('property="og:site_name" content="Bunyad"');
    expect(html).toContain('property="og:image" content="/cover.jpg"');
    expect(html).toContain('name="robots" content="all"');
  });
});

test("toInertia returns owned tags; globals excluded", () => {
  Head.defaults((head) => {
    head.title("App", { suffix: " - App" });
  });
  Head.inertiaGlobals((head) => {
    head.viewport("width=device-width, initial-scale=1").icon("/favicon.svg");
  });

  runWithHead(() => {
    Head.title("Dash");
    const inertia = Head.toInertia();
    expect(inertia.some((t) => t.includes("data-inertia=\"title\""))).toBe(true);
    expect(inertia.some((t) => t.includes("viewport"))).toBe(false);

    const html = Head.toHtml();
    expect(html).toContain('name="viewport"');
    expect(html).not.toContain('data-inertia="viewport"');
    expect(html).toContain('rel="icon" href="/favicon.svg"');
  });
});

test("HeadBuilder when/unless", () => {
  const b = new HeadBuilder();
  b.when(true, (h) => h.title("Yes")).unless(true, (h) => h.title("No"));
  const resolved = HeadBuilder.merge([b.layer()]);
  expect(resolved.title).toBe("Yes");
});

test("hiddenFromRobots", () => {
  runWithHead(() => {
    Head.hiddenFromRobots();
    expect(Head.toHtml()).toContain('content="none"');
  });
});

test("manager flush clears defaults", () => {
  Head.defaults((h) => h.title("X"));
  getHeadManager().flush();
  expect(Head.toHtml()).toBe("");
});

test("handleHead scopes runtime head per request url", async () => {
  Head.defaults((h) => h.canonical());
  const mw = handleHead();
  const req = new Request(new globalThis.Request("https://app.test/about"));
  const res = await mw.handle(req, async () => {
    expect(getHeadManager().url()).toContain("/about");
    const html = Head.toHtml();
    expect(html).toContain('rel="canonical" href="https://app.test/about"');
    return new Response("ok");
  });
  expect(res.status).toBe(200);
});

test("shareHeadWithInertia shares toInertia tags", async () => {
  Head.inertia({ prop: "head", enabled: true });
  const shared: Record<string, unknown> = {};
  shareHeadWithInertia((key, value) => {
    shared[key] = value;
  });
  expect(typeof shared.head).toBe("function");
  const req = new Request(new globalThis.Request("https://app.test/page"));
  await runWithHead(
    async () => {
      Head.title("Shared");
      const tags = await (shared.head as (r: Request) => Promise<string[]>)(req);
      expect(tags.some((t) => t.includes("Shared"))).toBe(true);
    },
    { url: "https://app.test/page" },
  );
});

test("shareHeadWithInertia skips when inertia disabled", () => {
  Head.inertia({ enabled: false });
  const shared: Record<string, unknown> = {};
  shareHeadWithInertia((key, value) => {
    shared[key] = value;
  });
  expect(shared.head).toBeUndefined();
});
