import { expect, test } from "bun:test";
import { Hash } from "@bunyad/auth";
import User from "@/Models/User.ts";
import { browser, client, live } from "./client.ts";

test("settings pages render for a signed-in user", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create({ name: "Ada Lovelace" }));

  (await app.get("/settings", browser)).assertRedirect("/settings/profile");
  const profile = await live(app, "/settings/profile");
  expect(profile.html).toContain('value="Ada Lovelace"');
  expect(profile.html).toContain('class="menu-active">Profile');
  expect((await live(app, "/settings/password")).html).toContain("Update password");
  await (await app.get("/settings/appearance", browser)).assertSee("Appearance");
});

test("guests are sent to the login page", async () => {
  const app = await client();
  (await app.get("/settings/profile", browser)).assertRedirect("/login");
});

test("the profile can be updated, and the nav stays highlighted", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);
  const page = await live(app, "/settings/profile");

  const result = await page.call("updateProfile", { name: "Grace Hopper", email: "grace@example.com" });
  expect(result.html).toContain("Saved.");
  expect(result.html).toContain('class="menu-active">Profile');

  const fresh = (await User.find(user.id))!;
  expect(fresh.name).toBe("Grace Hopper");
  expect(fresh.email).toBe("grace@example.com");
  expect(fresh.email_verified_at).toBeNull();
});

test("keeping the same email keeps it verified", async () => {
  const app = await client();
  const user = await User.factory().create({ email: "ada@example.com" });
  await app.actingAs(user);

  await (await live(app, "/settings/profile")).call("updateProfile", { name: "Ada", email: "ada@example.com" });

  expect((await User.find(user.id))!.email_verified_at).toBeTruthy();
});

test("the password can be updated with the current password", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);
  const page = await live(app, "/settings/password");

  const wrong = await page.call("updatePassword", {
    current_password: "wrong",
    password: "new-password",
    password_confirmation: "new-password",
  });
  expect(wrong.html).toContain("The password is incorrect.");
  expect(await Hash.check("password", (await User.find(user.id))!.password!)).toBe(true);

  const result = await page.call("updatePassword", {
    current_password: "password",
    password: "new-password",
    password_confirmation: "new-password",
  });
  expect(result.html).toContain("Saved.");
  expect(result.snapshot.data.password).toBe("");
  expect(await Hash.check("new-password", (await User.find(user.id))!.password!)).toBe(true);
});

test("deleting the account needs the right password", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);
  const page = await live(app, "/settings/profile");

  expect((await page.call("confirmUserDeletion")).html).toContain("modal-open");
  const wrong = await page.call("deleteUser", { deletePassword: "wrong" });
  expect(wrong.html).toContain("The password is incorrect.");
  expect(await User.find(user.id)).not.toBeNull();

  expect((await page.call("deleteUser", { deletePassword: "password" })).effects.redirect).toBe("/");
  expect(await User.find(user.id)).toBeNull();
  (await app.get("/dashboard", browser)).assertRedirect("/login");
});

test("settings actions need a signed-in user", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);
  const page = await live(app, "/settings/profile");
  const { snapshot } = await page.call("confirmUserDeletion");
  await app.post("/logout", undefined, browser);
  await app.get("/login", browser);

  // A snapshot taken while signed in does not act for the user afterwards.
  const response = await app.postJson("/live/update", {
    name: "settings.profile",
    snapshot,
    updates: { deletePassword: "password" },
    calls: [{ method: "deleteUser", params: [] }],
  });
  expect(response.status).toBe(401);
  expect(await User.find(user.id)).not.toBeNull();
});
