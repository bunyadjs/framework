import { expect, test } from "bun:test";
import { Hash } from "@bunyad/auth";
import User from "@/Models/User.ts";
import { client, expectPage, inertia, visit } from "./client.ts";

test("settings pages render for a signed-in user", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create({ name: "Ada Lovelace" }));

  (await app.get("/settings", inertia)).assertRedirect("/settings/profile");
  const profile = await expectPage(app, "/settings/profile", "settings/profile");
  expect(profile.props.auth.user.name).toBe("Ada Lovelace");
  expect(profile.props.mustVerifyEmail).toBe(false);
  await expectPage(app, "/settings/password", "settings/password");
  await expectPage(app, "/settings/appearance", "settings/appearance");
});

test("guests are sent to the login page", async () => {
  const app = await client();
  (await app.get("/settings/profile", inertia)).assertRedirect("/login");
});

test("the profile update redirects with 303", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  const res = await app.patch("/settings/profile", { name: "Grace Hopper", email: "grace@example.com" }, inertia);
  expect(res.status).toBe(303);
  res.assertRedirect("/settings/profile");

  const fresh = (await User.find(user.id))!;
  expect(fresh.name).toBe("Grace Hopper");
  expect(fresh.email_verified_at).toBeNull();
});

test("the password can be updated with the current password", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  await app.put("/settings/password", {
    current_password: "wrong",
    password: "new-password",
    password_confirmation: "new-password",
  }, { ...inertia, Referer: "http://localhost/settings/password" });
  expect((await visit(app, "/settings/password")).props.errors.current_password).toBeDefined();

  (await app.put("/settings/password", {
    current_password: "password",
    password: "new-password",
    password_confirmation: "new-password",
  }, inertia)).assertRedirect("/settings/password");
  expect(await Hash.check("new-password", (await User.find(user.id))!.password!)).toBe(true);
});

test("deleting the account needs the right password", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  await app.delete("/settings/profile", { password: "wrong" }, { ...inertia, Referer: "http://localhost/settings/profile" });
  expect((await visit(app, "/settings/profile")).props.errors.userDeletion.password).toBeDefined();
  expect(await User.find(user.id)).not.toBeNull();

  (await app.delete("/settings/profile", { password: "password" }, inertia)).assertRedirect("/");
  expect(await User.find(user.id)).toBeNull();
});
