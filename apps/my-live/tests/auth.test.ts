import { expect, test } from "bun:test";
import { Notification, ResetPassword } from "@bunyad/framework";
import User from "@/Models/User.ts";
import { browser, client, live } from "./client.ts";

test("welcome, login, and register pages render", async () => {
  const app = await client();

  (await app.get("/", browser)).assertOk();
  expect((await live(app, "/login")).html).toContain("Log in to your account");
  expect((await live(app, "/register")).html).toContain("Create an account");
});

test("new users are logged in and land on the dashboard", async () => {
  const app = await client();
  const page = await live(app, "/register");

  const result = await page.call("register", {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "password",
  });
  expect(result.effects.navigate).toBe("/dashboard");

  const dashboard = await app.get("/dashboard", browser);
  dashboard.assertOk();
  await dashboard.assertSee("Ada Lovelace");
});

test("registration needs a matching password confirmation", async () => {
  const app = await client();
  const page = await live(app, "/register");

  const result = await page.call("register", {
    name: "Ada",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "different",
  });

  expect(result.effects.navigate).toBeNull();
  expect(result.effects.errors.password).toBeDefined();
  expect(result.html).toContain('value="ada@example.com"');
  expect(await User.where("email", "ada@example.com").exists()).toBe(false);
});

test("users log in with valid credentials", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  const page = await live(app, "/login");

  const result = await page.call("login", { email: "ada@example.com", password: "password" });
  expect(result.effects.navigate).toBe("/dashboard");
  expect(result.snapshot.data.password).toBe("");
  (await app.get("/dashboard", browser)).assertOk();
});

test("a wrong password shows an error and keeps the user a guest", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  const page = await live(app, "/login");

  const result = await page.call("login", { email: "ada@example.com", password: "wrong" });
  expect(result.html).toContain("These credentials do not match our records.");
  (await app.get("/dashboard", browser)).assertRedirect("/login");
});

test("five failed logins lock the email out", async () => {
  const app = await client();
  await User.factory().create({ email: "locked@example.com" });
  const page = await live(app, "/login");

  for (let i = 0; i < 5; i += 1) {
    await page.call("login", { email: "locked@example.com", password: "wrong" });
  }
  const result = await page.call("login", { email: "locked@example.com", password: "password" });

  expect(result.html).toContain("Too many login attempts.");
  (await app.get("/dashboard", browser)).assertRedirect("/login");
});

test("remember me sets a cookie", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  const page = await live(app, "/login");

  await page.call("login", { email: "ada@example.com", password: "password", remember: true });

  const user = await User.where("email", "ada@example.com").first();
  expect(user?.remember_token).toBeTruthy();
});

test("users can log out", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  await (await live(app, "/login")).call("login", { email: "ada@example.com", password: "password" });

  (await app.post("/logout", undefined, browser)).assertRedirect("/");
  (await app.get("/dashboard", browser)).assertRedirect("/login");
});

test("a reset link is mailed and resets the password", async () => {
  const app = await client();
  const fake = Notification.fake();
  const user = await User.factory().create({ email: "ada@example.com" });

  const forgot = await live(app, "/forgot-password");
  const sent = await forgot.call("sendPasswordResetLink", { email: "ada@example.com" });
  expect(sent.html).toContain("A reset link will be sent");

  Notification.assertSentTo(user, ResetPassword);
  const mail = fake.sent(ResetPassword)[0]!.notification as ResetPassword;
  fake.restore();

  const url = new URL(mail.url);
  const reset = await live(app, url.pathname + url.search);
  expect(reset.html).toContain('value="ada@example.com"');

  const result = await reset.call("resetPassword", {
    password: "new-password",
    password_confirmation: "new-password",
  });
  expect(result.effects.navigate).toBe("/login");
  await (await app.get("/login", browser)).assertSee("Your password has been reset.");

  const login = await live(app, "/login");
  expect((await login.call("login", { email: "ada@example.com", password: "new-password" })).effects.navigate)
    .toBe("/dashboard");
});

test("a bad reset token is rejected", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  const page = await live(app, "/reset-password/nope?email=ada@example.com");

  const result = await page.call("resetPassword", {
    password: "new-password",
    password_confirmation: "new-password",
  });
  expect(result.html).toContain("invalid or has expired");
});

test("the password confirmation screen checks the password", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create());
  const page = await live(app, "/confirm-password");

  expect((await page.call("confirmPassword", { password: "wrong" })).html)
    .toContain("The provided password is incorrect.");
  expect((await page.call("confirmPassword", { password: "password" })).effects.navigate).toBe("/dashboard");
});
