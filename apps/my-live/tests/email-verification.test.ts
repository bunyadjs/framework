import { afterAll, beforeAll, expect, test } from "bun:test";
import { mustVerifyEmailMethods, verificationUrl, type MustVerifyEmail } from "@bunyad/auth";
import { Notification, VerifyEmail } from "@bunyad/framework";
import User from "@/Models/User.ts";
import { browser, client, live } from "./client.ts";

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

  await (await live(app, "/register")).call("register", {
    name: "Ada",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "password",
  });

  Notification.assertSentTo((await User.where("email", "ada@example.com").first())!, VerifyEmail);
  fake.restore();
});

test("unverified users are sent to the verification notice, which can resend", async () => {
  const app = await client();
  const fake = Notification.fake();
  const user = await User.factory().unverified().create();
  await app.actingAs(user);

  (await app.get("/dashboard", browser)).assertRedirect("/email/verify");
  const page = await live(app, "/email/verify");
  expect(page.html).toContain("Verify email");

  expect((await page.call("sendVerification")).html).toContain("A new verification link has been sent");
  Notification.assertSentTo(user, VerifyEmail);
  fake.restore();
});

test("verified users skip the notice", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create());
  (await app.get("/email/verify", browser)).assertRedirect("/dashboard");
});

test("the signed link verifies the email", async () => {
  const app = await client();
  const user = await User.factory().unverified().create();
  await app.actingAs(user);

  const url = await verificationUrl(user as unknown as MustVerifyEmail);
  (await app.get(url, browser)).assertRedirect("/dashboard?verified=1");
  expect((await User.find(user.id))!.email_verified_at).toBeTruthy();
});
