import { expect, test } from "bun:test";
import { Feature } from "@bunyad/features";
import { bootApp } from "./helpers.ts";

test("features endpoint resolves feature flags", async () => {
  const { fetch } = await bootApp();

  const guest = await fetch(new Request("http://localhost/features"));
  expect(guest.status).toBe(200);
  const guestBody = (await guest.json()) as Record<string, unknown>;
  expect(guestBody["new-api"]).toBe(true);
  expect(guestBody["purchase-button"]).toBe("seafoam-green");
  expect(guestBody["beta-dashboard"]).toBe(false);
});

test("Feature.for scopes beta-dashboard to user id 1", async () => {
  await bootApp();
  expect(await Feature.for({ id: 1 }).active("beta-dashboard")).toBe(true);
  expect(await Feature.for({ id: 2 }).active("beta-dashboard")).toBe(false);
});
