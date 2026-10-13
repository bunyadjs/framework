import { expect, test } from "bun:test";
import { robots, robotsFor, robotsSitemapLine } from "./robots.ts";

test("builder groups, rules and sitemap lines", () => {
  expect(
    robots()
      .userAgent("Googlebot")
      .userAgent("Bingbot")
      .disallow("/admin")
      .userAgent("*")
      .allow("/")
      .sitemap("https://e.com/sitemap.xml")
      .sitemap("https://e.com/sitemap.xml")
      .toString(),
  ).toBe(
    "User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /admin\n\nUser-agent: *\nAllow: /\n\nSitemap: https://e.com/sitemap.xml\n",
  );
});

test("default group is * and newlines cannot inject directives", () => {
  expect(robots().disallow("/x\nSitemap: https://evil").toString()).toBe(
    "User-agent: *\nDisallow: /x Sitemap: https://evil\n",
  );
  expect(robotsSitemapLine("https://e.com/s.xml")).toBe(
    "Sitemap: https://e.com/s.xml",
  );
});

test("robotsFor: one Sitemap: line per domain, host-scoped, custom rules", () => {
  const config = {
    domains: {
      "a.com": { baseUrl: "https://a.com" },
      "b.com": { baseUrl: "https://b.com" },
    },
    robots: { rules: [{ userAgent: "*", disallow: ["/admin"] }] },
  };
  expect(robotsFor(config)).toBe(
    "User-agent: *\nDisallow: /admin\n\nSitemap: https://a.com/sitemap.xml\nSitemap: https://b.com/sitemap.xml\n",
  );
  expect(robotsFor(config, "B.com")).toBe(
    "User-agent: *\nDisallow: /admin\n\nSitemap: https://b.com/sitemap.xml\n",
  );
  expect(robotsFor({ baseUrl: "https://a.com" })).toBe(
    "User-agent: *\nAllow: /\n\nSitemap: https://a.com/sitemap.xml\n",
  );
});
