import { afterAll, beforeAll, expect, test } from "bun:test";
import { mustVerifyEmailMethods, verificationUrl, type MustVerifyEmail } from "@bunyad/auth";
import { Notification, VerifyEmail } from "@bunyad/framework";
import User from "@/Models/User.ts";
import { client, expectPage, inertia, visit } from "./client.ts";

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
  }, inertia);

  Notification.assertSentTo((await User.where("email", "ada@example.com").first())!, VerifyEmail);
  fake.restore();
});

test("unverified users see the notice and can resend", async () => {
  const app = await client();
  const fake = Notification.fake();
  const user = await User.factory().unverified().create();
  await app.actingAs(user);

  (await app.get("/dashboard", inertia)).assertRedirect("/email/verify");
  await expectPage(app, "/email/verify", "auth/verify-email");
  await app.post("/email/verification-notification", undefined, { ...inertia, Referer: "http://localhost/email/verify" });
  expect((await visit(app, "/email/verify")).props.status).toBe("verification-link-sent");
  Notification.assertSentTo(user, VerifyEmail);
  fake.restore();
});

test("the signed link verifies the email", async () => {
  const app = await client();
  const user = await User.factory().unverified().create();
  await app.actingAs(user);

  const url = await verificationUrl(user as unknown as MustVerifyEmail);
  (await app.get(url, inertia)).assertRedirect("/dashboard?verified=1");
  expect((await User.find(user.id))!.email_verified_at).toBeTruthy();
});
