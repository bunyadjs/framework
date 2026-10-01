import { expect, test } from "bun:test";
import { Hash } from "@bunyad/auth";
import User from "@/Models/User.ts";
import { browser, client } from "./client.ts";

test("settings pages render for a signed-in user", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create({ name: "Ada Lovelace" }));

  (await app.get("/settings")).assertRedirect("/settings/profile");
  const profile = await app.get("/settings/profile");
  await profile.assertSee('value="Ada Lovelace"');
  await profile.assertSee('class="menu-active">Profile');
  await (await app.get("/settings/password")).assertSee("Update password");
  await (await app.get("/settings/appearance")).assertSee("Appearance");
});

test("guests are sent to the login page", async () => {
  const app = await client();
  (await app.get("/settings/profile")).assertRedirect("/login");
});

test("the profile can be updated", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  (await app.patch("/settings/profile", { name: "Grace Hopper", email: "grace@example.com" }, browser))
    .assertRedirect("/settings/profile");

  const fresh = (await User.find(user.id))!;
  expect(fresh.name).toBe("Grace Hopper");
  expect(fresh.email).toBe("grace@example.com");
  expect(fresh.email_verified_at).toBeNull();
  await (await app.get("/settings/profile")).assertSee("Saved.");
});

test("keeping the same email keeps it verified", async () => {
  const app = await client();
  const user = await User.factory().create({ email: "ada@example.com" });
  await app.actingAs(user);

  await app.patch("/settings/profile", { name: "Ada", email: "ada@example.com" }, browser);

  expect((await User.find(user.id))!.email_verified_at).toBeTruthy();
});

test("the password can be updated with the current password", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  (await app.put("/settings/password", {
    current_password: "password",
    password: "new-password",
    password_confirmation: "new-password",
  }, browser)).assertRedirect("/settings/password");

  expect(await Hash.check("new-password", (await User.find(user.id))!.password!)).toBe(true);
});

test("a wrong current password is rejected", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  await app.put("/settings/password", {
    current_password: "wrong",
    password: "new-password",
    password_confirmation: "new-password",
  }, { ...browser, Referer: "http://localhost/settings/password" });

  expect(await Hash.check("password", (await User.find(user.id))!.password!)).toBe(true);
  await (await app.get("/settings/password")).assertSee("text-error");
});

test("users can delete their account", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  (await app.delete("/settings/profile", { password: "password" }, browser)).assertRedirect("/");

  expect(await User.find(user.id)).toBeNull();
  (await app.get("/dashboard")).assertRedirect("/login");
});

test("deleting needs the right password", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  await app.delete("/settings/profile", { password: "wrong" }, {
    ...browser,
    Referer: "http://localhost/settings/profile",
  });

  expect(await User.find(user.id)).not.toBeNull();
  await (await app.get("/settings/profile")).assertSee("modal-open");
});
