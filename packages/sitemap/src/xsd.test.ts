/** F1: generated XML validates against sitemaps.org + Google XSDs (skips without xmllint). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memorySink } from "./sinks.ts";
import { Sitemap } from "./sitemap.ts";
import { Url } from "./url.ts";
import { SitemapWriter } from "./writer.ts";

const xmllint = Bun.which("xmllint");
const xsd = (name: string) => join(import.meta.dir, "fixtures/xsd", name);
let dir = "";

async function validate(xml: string, schema: string): Promise<string> {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.xml`);
  await writeFile(file, xml);
  const proc = Bun.spawn(
    [xmllint ?? "xmllint", "--noout", "--schema", schema, file],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const err = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return code === 0 ? "ok" : err;
}

describe.skipIf(!xmllint)("XSD validation (xmllint)", () => {
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "bunyad-sitemap-xsd-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("urlset with every extension, alternates + lastmod + changefreq + priority", async () => {
    const xml = Sitemap.create({ baseUrl: "https://example.com" })
      .add("/")
      .add(
        Url.create("/p?a=1&b=2")
          .addAlternate("/ur/p", "ur")
          .addAlternate("/p", "x-default")
          .setLastModificationDate(Date.UTC(2026, 0, 2))
          .setChangeFrequency("weekly")
          .setPriority(0.8)
          .addImage("/i.png")
          .addVideo(
            "/t.jpg",
            "T & <b>",
            "D",
            "/v.mp4",
            "/player",
            { duration: 60, family_friendly: true },
            {},
            {},
            ["x"],
          )
          .addNews("Daily", "en", "Title", Date.UTC(2026, 0, 2)),
      )
      .add(Url.create("/only-alt").addAlternate("/de/only-alt", "de"))
      .render();
    expect(await validate(xml, xsd("all.xsd"))).toBe("ok");
  });

  test("defaults-only and plain urlsets", async () => {
    const xml = Sitemap.create({
      baseUrl: "https://e.com",
      defaults: { changefreq: "daily", priority: 0.5 },
    })
      .add(["/a", "/b"])
      .render();
    expect(await validate(xml, xsd("all.xsd"))).toBe("ok");
  });

  test("split parts and the index validate", async () => {
    const sink = memorySink();
    const writer = new SitemapWriter({
      sink,
      baseUrl: "https://e.com",
      maxUrls: 2,
    });
    for (let i = 0; i < 3; i++)
      await writer.write(
        Url.create(`/p/${i}`)
          .addAlternate(`/de/p/${i}`, "de")
          .setLastModificationDate(0),
      );
    await writer.close();
    expect(await validate(sink.text("sitemap.xml"), xsd("siteindex.xsd"))).toBe(
      "ok",
    );
    expect(await validate(sink.text("sitemap-1.xml"), xsd("all.xsd"))).toBe(
      "ok",
    );
  });
});
