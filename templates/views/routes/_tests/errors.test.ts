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
