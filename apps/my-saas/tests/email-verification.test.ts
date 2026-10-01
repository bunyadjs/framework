import { afterAll, beforeAll, expect, test } from "bun:test";
import { mustVerifyEmailMethods, verificationUrl, type MustVerifyEmail } from "@bunyad/auth";
import { Notification, VerifyEmail } from "@bunyad/framework";
import User from "@/Models/User.ts";
import { browser, client } from "./client.ts";

// The kit ships with verification off; turn it on the way `@MustVerifyEmail()` does.
const methods = mustVerifyEmailMethods(function (this: User) {
  return this.email;
});
beforeAll(() => Object.assign(User.prototype, methods));
afterAll(() => {
  for (const name of Object.keys(methods)) delete (User.prototype as unknown as Record<string, unknown>)[name];
});

test("registering sends a verification email", async () => {
  const app = await client();
  const fake = Notification.fake();

  await app.post("/register", {
    name: "Ada",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "password",
  }, browser);

  const user = (await User.where("email", "ada@example.com").first())!;
  Notification.assertSentTo(user, VerifyEmail);
  fake.restore();
});

test("unverified users are sent to the verification notice", async () => {
  const app = await client();
  const user = await User.factory().unverified().create();
  await app.actingAs(user);

  (await app.get("/dashboard")).assertRedirect("/email/verify");
  await (await app.get("/email/verify")).assertSee("Verify email");
});

test("the signed link verifies the email", async () => {
  const app = await client();
  const user = await User.factory().unverified().create();
  await app.actingAs(user);

  const url = await verificationUrl(user as unknown as MustVerifyEmail);
  (await app.get(url)).assertRedirect("/dashboard?verified=1");

  const fresh = (await User.find(user.id))!;
  expect(fresh.email_verified_at).toBeTruthy();
  (await app.get("/dashboard")).assertOk();
});

test("a tampered link is rejected", async () => {
  const app = await client();
  const user = await User.factory().unverified().create();
  await app.actingAs(user);

  const url = await verificationUrl(user as unknown as MustVerifyEmail);
  (await app.get(url.replace(/\/[0-9a-f]{40}\?/, `/${"0".repeat(40)}?`))).assertStatus(403);
  expect((await User.find(user.id))!.email_verified_at).toBeFalsy();
});
