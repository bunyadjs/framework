import { expect, test } from "bun:test";
import { TwoFactor, totp } from "@bunyad/auth";
import User from "@/Models/User.ts";
import { browser, client, live } from "./client.ts";

/** A user with two-factor already on. Create the client first: it resets the database. */
async function twoFactorUser(): Promise<User> {
  const user = await User.factory().create({ email: "ada@example.com" });
  await TwoFactor.enable(user);
  user.two_factor_confirmed_at = new Date();
  await user.save();
  return (await User.find(user.id))!;
}

test("the two-factor settings page asks for the password first, then comes back", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create());

  (await app.get("/settings/two-factor", browser)).assertRedirect("/confirm-password");
  const confirm = await live(app, "/confirm-password");
  expect((await confirm.call("confirmPassword", { password: "password" })).effects.navigate)
    .toBe("http://localhost/settings/two-factor");
  expect((await live(app, "/settings/two-factor")).html).toContain("Enable 2FA");
});

test("enabling shows a QR code and confirming a code turns it on", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);
  await app.withSession({ "auth.password_confirmed_at": Date.now() / 1000 });
  const page = await live(app, "/settings/two-factor");

  const pending = await page.call("enable");
  expect(pending.html).toContain("<svg");
  // The secret is rendered, never stored in the snapshot the browser holds.
  expect(JSON.stringify(pending.snapshot)).not.toContain((await User.find(user.id))!.twoFactorSecret());

  expect((await page.call("confirm", { code: "000000" })).html).toContain("was invalid");

  const secret = (await User.find(user.id))!.twoFactorSecret();
  const on = await page.call("confirm", { code: totp(secret) });
  expect(on.html).toContain("Recovery codes");
  expect((await User.find(user.id))!.hasEnabledTwoFactorAuthentication()).toBe(true);
});

test("two-factor actions need a recent password confirmation", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);
  await app.withSession({ "auth.password_confirmed_at": Date.now() / 1000 });
  const page = await live(app, "/settings/two-factor");
  await app.withSession({ "auth.password_confirmed_at": 0 });

  await expect(page.call("enable")).rejects.toThrow("423");
  expect((await User.find(user.id))!.two_factor_secret).toBeFalsy();
});

test("users with two-factor enter a code after their password", async () => {
  const app = await client();
  const user = await twoFactorUser();

  const login = await live(app, "/login");
  expect((await login.call("login", { email: "ada@example.com", password: "password" })).effects.navigate)
    .toBe("/two-factor-challenge");
  (await app.get("/dashboard", browser)).assertRedirect("/login");

  const challenge = await live(app, "/two-factor-challenge");
  expect((await challenge.call("verify", { code: "000000" })).html).toContain("was invalid");
  // The guest visit to /dashboard above is remembered as the intended URL.
  expect((await challenge.call("verify", { code: totp(user.twoFactorSecret()) })).effects.navigate)
    .toBe("http://localhost/dashboard");
  (await app.get("/dashboard", browser)).assertOk();
});

test("a recovery code signs in once and is replaced", async () => {
  const app = await client();
  const user = await twoFactorUser();
  const [code] = user.recoveryCodes();

  await (await live(app, "/login")).call("login", { email: "ada@example.com", password: "password" });
  const challenge = await live(app, "/two-factor-challenge");
  await challenge.call("toggleRecovery");
  expect((await challenge.call("verify", { recovery_code: code })).effects.navigate).toBe("/dashboard");

  const codes = (await User.find(user.id))!.recoveryCodes();
  expect(codes).toHaveLength(8);
  expect(codes).not.toContain(code);
});

test("the challenge page needs a password step first", async () => {
  const app = await client();
  (await app.get("/two-factor-challenge", browser)).assertRedirect("/login");
});

test("two-factor can be turned off", async () => {
  const app = await client();
  const user = await twoFactorUser();
  await app.actingAs(user);
  await app.withSession({ "auth.password_confirmed_at": Date.now() / 1000 });

  const page = await live(app, "/settings/two-factor");
  expect((await page.call("disable")).html).toContain("Enable 2FA");
  expect((await User.find(user.id))!.hasEnabledTwoFactorAuthentication()).toBe(false);
});
