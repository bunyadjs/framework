import { expect, test } from "bun:test";
import { TwoFactor, totp } from "@bunyad/auth";
import User from "@/Models/User.ts";
import { client, expectPage, inertia, visit } from "./client.ts";

/** A user with two-factor already on. Create the client first: it resets the database. */
async function twoFactorUser(): Promise<User> {
  const user = await User.factory().create({ email: "ada@example.com" });
  await TwoFactor.enable(user);
  user.two_factor_confirmed_at = new Date();
  await user.save();
  return (await User.find(user.id))!;
}

test("the two-factor page asks for the password first, then comes back", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create());

  (await app.get("/settings/two-factor", inertia)).assertRedirect("/confirm-password");
  (await app.post("/confirm-password", { password: "password" }, inertia))
    .assertRedirect("http://localhost/settings/two-factor");
  expect((await expectPage(app, "/settings/two-factor", "settings/two-factor")).props.enabled).toBe(false);
});

test("enabling shows a QR code and confirming a code turns it on", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);
  await app.withSession({ "auth.password_confirmed_at": Date.now() / 1000 });

  (await app.post("/settings/two-factor", undefined, inertia)).assertRedirect("/settings/two-factor");
  const pending = await visit(app, "/settings/two-factor");
  expect(pending.props.pending).toBe(true);
  expect(pending.props.qrCodeSvg).toStartWith("<svg");

  const secret = (await User.find(user.id))!.twoFactorSecret();
  (await app.post("/settings/two-factor/confirm", { code: totp(secret) }, inertia)).assertRedirect("/settings/two-factor");
  const on = await visit(app, "/settings/two-factor");
  expect(on.props.enabled).toBe(true);
  expect(on.props.recoveryCodes).toHaveLength(8);
});

test("users with two-factor enter a code after their password", async () => {
  const app = await client();
  const user = await twoFactorUser();

  (await app.post("/login", { email: "ada@example.com", password: "password" }, inertia)).assertRedirect("/two-factor-challenge");
  await expectPage(app, "/two-factor-challenge", "auth/two-factor-challenge");

  await app.post("/two-factor-challenge", { code: "000000" }, { ...inertia, Referer: "http://localhost/two-factor-challenge" });
  expect((await visit(app, "/two-factor-challenge")).props.errors.code).toContain("was invalid");

  (await app.post("/two-factor-challenge", { code: totp(user.twoFactorSecret()) }, inertia)).assertRedirect("/dashboard");
  await expectPage(app, "/dashboard", "dashboard");
});

test("a recovery code signs in once", async () => {
  const app = await client();
  const user = await twoFactorUser();
  const [code] = user.recoveryCodes();

  await app.post("/login", { email: "ada@example.com", password: "password" }, inertia);
  (await app.post("/two-factor-challenge", { recovery_code: code }, inertia)).assertRedirect("/dashboard");
  expect((await User.find(user.id))!.recoveryCodes()).not.toContain(code);
});

test("two-factor can be turned off", async () => {
  const app = await client();
  const user = await twoFactorUser();
  await app.actingAs(user);
  await app.withSession({ "auth.password_confirmed_at": Date.now() / 1000 });

  const res = await app.delete("/settings/two-factor", undefined, inertia);
  expect(res.status).toBe(303);
  expect((await User.find(user.id))!.hasEnabledTwoFactorAuthentication()).toBe(false);
});
