import { expect, test } from "bun:test";
import { TwoFactor, totp } from "@bunyad/auth";
import User from "@/Models/User.ts";
import { browser, client } from "./client.ts";

/** A user with two-factor already on. Create the client first: it resets the database. */
async function twoFactorUser(): Promise<User> {
  const user = await User.factory().create({ email: "ada@example.com" });
  await TwoFactor.enable(user);
  user.two_factor_confirmed_at = new Date();
  await user.save();
  return (await User.find(user.id))!;
}

/** Signed in, with the password confirmed so two-factor settings open. */
async function confirm(app: Awaited<ReturnType<typeof client>>, user: User) {
  await app.actingAs(user);
  await app.withSession({ "auth.password_confirmed_at": Date.now() / 1000 });
}

test("the two-factor settings page asks for the password first, then comes back", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create());

  (await app.get("/settings/two-factor", browser)).assertRedirect("/confirm-password");
  (await app.post("/confirm-password", { password: "password" }, browser))
    .assertRedirect("http://localhost/settings/two-factor");
  await (await app.get("/settings/two-factor", browser)).assertSee("Enable 2FA");
});

test("enabling shows a QR code and confirming a code turns it on", async () => {
  const app = await client();
  const user = await User.factory().create();
  await confirm(app, user);

  (await app.post("/settings/two-factor", undefined, browser)).assertRedirect("/settings/two-factor");
  const setup = await app.get("/settings/two-factor", browser);
  await setup.assertSee("<svg");
  await setup.assertSee("Setup key");

  let fresh = (await User.find(user.id))!;
  expect(fresh.hasEnabledTwoFactorAuthentication()).toBe(false);

  await app.post("/settings/two-factor/confirm", { code: "000000" }, {
    ...browser,
    Referer: "http://localhost/settings/two-factor",
  });
  await (await app.get("/settings/two-factor", browser)).assertSee("was invalid");

  (await app.post("/settings/two-factor/confirm", { code: totp(fresh.twoFactorSecret()) }, browser))
    .assertRedirect("/settings/two-factor");
  fresh = (await User.find(user.id))!;
  expect(fresh.hasEnabledTwoFactorAuthentication()).toBe(true);
  await (await app.get("/settings/two-factor", browser)).assertSee("Recovery codes");
});

test("users with two-factor enter a code after their password", async () => {
  const app = await client();
  const user = await twoFactorUser();

  (await app.post("/login", { email: "ada@example.com", password: "password" }, browser))
    .assertRedirect("/two-factor-challenge");
  (await app.get("/dashboard", browser)).assertRedirect("/login");
  await (await app.get("/two-factor-challenge", browser)).assertSee("Authentication code");

  await app.post("/two-factor-challenge", { code: "000000" }, {
    ...browser,
    Referer: "http://localhost/two-factor-challenge",
  });
  await (await app.get("/two-factor-challenge", browser)).assertSee("was invalid");

  // The guest visit to /dashboard above is remembered as the intended URL.
  (await app.post("/two-factor-challenge", { code: totp(user.twoFactorSecret()) }, browser))
    .assertRedirect("http://localhost/dashboard");
  (await app.get("/dashboard", browser)).assertOk();
});

test("a recovery code signs in once and is replaced", async () => {
  const app = await client();
  const user = await twoFactorUser();
  const [code] = user.recoveryCodes();

  await app.post("/login", { email: "ada@example.com", password: "password" }, browser);
  (await app.post("/two-factor-challenge", { recovery_code: code }, browser)).assertRedirect("/dashboard");

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
  await confirm(app, user);

  (await app.delete("/settings/two-factor", undefined, browser)).assertRedirect("/settings/two-factor");
  expect((await User.find(user.id))!.hasEnabledTwoFactorAuthentication()).toBe(false);

  await app.post("/logout", undefined, browser);
  (await app.post("/login", { email: "ada@example.com", password: "password" }, browser))
    .assertRedirect("/dashboard");
});
