import { test } from "bun:test";
import User from "@/Models/User.ts";
import { browser, client } from "@/Testing/client.ts";

test("the public welcome page knows who is signed in", async () => {
  const app = await client();
  await (await app.get("/")).assertSee("Log in");

  await User.create({ name: "Ada", email: "ada@example.com", password: "password" });
  (await app.post("/login", { email: "ada@example.com", password: "password" }, browser)).assertStatus(302);

  const page = await app.get("/", browser);
  await page.assertSee("Go to dashboard");
  await page.assertDontSee("Log in");
});
