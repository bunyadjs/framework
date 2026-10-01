import { afterAll, expect, test } from "bun:test";
import { bootApp } from "./helpers.ts";

// A first page visit from a browser. Without `Accept: text/html` the Inertia
// middleware skips shared props, and the Welcome page needs `auth`.
const browserVisit = { headers: { Accept: "text/html" } };

afterAll(() => {
  delete process.env.INERTIA_SSR_ENABLED;
  delete process.env.INERTIA_SSR_MODE;
  delete process.env.INERTIA_SSR_URL;
  delete process.env.INERTIA_SSR_TIMEOUT;
});

test("Inertia inline SSR renders Welcome markup into HTML", async () => {
  process.env.INERTIA_SSR_ENABLED = "true";
  process.env.INERTIA_SSR_MODE = "inline";

  const { fetch } = await bootApp();
  const res = await fetch(new Request("http://localhost/inertia", browserVisit));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('data-server-rendered="true"');
  expect(html).toContain("Hello from Bunyad");
  expect(html).toContain("Inertia");
});

test("Inertia SSR falls back when disabled", async () => {
  process.env.INERTIA_SSR_ENABLED = "false";

  const { fetch } = await bootApp();
  const res = await fetch(new Request("http://localhost/inertia", browserVisit));
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('data-page="app"');
  expect(html).not.toContain("data-server-rendered");
});
