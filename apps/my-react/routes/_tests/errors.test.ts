import { expect, test } from "bun:test";
import { client, inertia } from "@/Testing/client.ts";

test("an unknown page answers with the app's own 404 page", async () => {
  const app = await client();

  const html = await app.get("/no-such-page", { Accept: "text/html" });
  html.assertNotFound();
  await html.assertSee("Page not found");

  const json = await app.get("/no-such-page", { Accept: "application/json" });
  json.assertNotFound();
  expect(json.headers.get("content-type")).toContain("application/json");
});

test("an Inertia visit gets the 404 page component with the status", async () => {
  const app = await client();

  const res = await app.get("/no-such-page", inertia);
  res.assertNotFound();
  const page = (await res.json()) as { component: string; props: { status: number } };
  expect(page.component).toBe("NotFoundPage");
  expect(page.props.status).toBe(404);
});
