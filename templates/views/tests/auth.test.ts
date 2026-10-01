import { expect, test } from "bun:test";
import { Notification, ResetPassword } from "@bunyad/framework";
import User from "@/Models/User.ts";
import { browser, client } from "./client.ts";

test("welcome, login, and register pages render", async () => {
  const app = await client();

  (await app.get("/")).assertOk();
  await (await app.get("/login")).assertSee("Log in to your account");
  await (await app.get("/register")).assertSee("Create an account");
});

test("new users are logged in and land on the dashboard", async () => {
  const app = await client();

  (await app.post("/register", {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "password",
  }, browser)).assertRedirect("/dashboard");

  const dashboard = await app.get("/dashboard");
  dashboard.assertOk();
  await dashboard.assertSee("Ada Lovelace");
  expect(await User.where("email", "ada@example.com").exists()).toBe(true);
});

test("registration needs a matching password confirmation", async () => {
  const app = await client();
  await app.get("/register");

  (await app.post("/register", {
    name: "Ada",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "different",
  }, { ...browser, Referer: "http://localhost/register" })).assertRedirect("http://localhost/register");

  const page = await app.get("/register");
  await page.assertSee("confirmation");
  await page.assertSee('value="ada@example.com"');
  expect(await User.where("email", "ada@example.com").exists()).toBe(false);
});

test("users log in with valid credentials and are redirected to the dashboard", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });

  (await app.post("/login", { email: "ada@example.com", password: "password" }, browser))
    .assertRedirect("/dashboard");
  (await app.get("/dashboard")).assertOk();
});

test("a wrong password shows an error and keeps the user a guest", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });

  await app.post("/login", { email: "ada@example.com", password: "wrong" }, {
    ...browser,
    Referer: "http://localhost/login",
  });

  await (await app.get("/login")).assertSee("These credentials do not match our records.");
  (await app.get("/dashboard")).assertRedirect("/login");
});

test("five failed logins lock the email out", async () => {
  const app = await client();
  await User.factory().create({ email: "locked@example.com" });

  for (let i = 0; i < 5; i += 1) {
    await app.post("/login", { email: "locked@example.com", password: "wrong" }, browser);
  }
  await app.post("/login", { email: "locked@example.com", password: "password" }, {
    ...browser,
    Referer: "http://localhost/login",
  });

  await (await app.get("/login")).assertSee("Too many login attempts.");
  (await app.get("/dashboard")).assertRedirect("/login");
});

test("remember me sets a cookie that restores the login", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });

  const res = await app.post("/login", {
    email: "ada@example.com",
    password: "password",
    remember: "1",
  }, browser);
  const remember = res.headers.getSetCookie().find((c) => c.startsWith("remember_web="));
  expect(remember).toBeDefined();

  const user = await User.where("email", "ada@example.com").first();
  expect(user?.remember_token).toBeTruthy();
});

test("users can log out", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  await app.post("/login", { email: "ada@example.com", password: "password" }, browser);

  (await app.post("/logout", undefined, browser)).assertRedirect("/");
  (await app.get("/dashboard")).assertRedirect("/login");
});

test("a reset link is mailed and resets the password", async () => {
  const app = await client();
  const fake = Notification.fake();
  const user = await User.factory().create({ email: "ada@example.com" });

  (await app.get("/forgot-password")).assertOk();
  (await app.post("/forgot-password", { email: "ada@example.com" }, {
    ...browser,
    Referer: "http://localhost/forgot-password",
  })).assertRedirect("http://localhost/forgot-password");

  Notification.assertSentTo(user, ResetPassword);
  const mail = fake.sent(ResetPassword)[0]!.notification as ResetPassword;
  expect(mail.url).toContain(`/reset-password/${mail.token}`);
  fake.restore();

  const path = new URL(mail.url).pathname + new URL(mail.url).search;
  await (await app.get(path)).assertSee('value="ada@example.com"');

  (await app.post("/reset-password", {
    token: mail.token,
    email: "ada@example.com",
    password: "new-password",
    password_confirmation: "new-password",
  }, browser)).assertRedirect("/login");

  (await app.post("/login", { email: "ada@example.com", password: "new-password" }, browser))
    .assertRedirect("/dashboard");
});

test("a bad reset token is rejected", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  await app.get("/reset-password/nope?email=ada@example.com");

  await app.post("/reset-password", {
    token: "nope",
    email: "ada@example.com",
    password: "new-password",
    password_confirmation: "new-password",
  }, { ...browser, Referer: "http://localhost/reset-password/nope" });

  await (await app.get("/reset-password/nope")).assertSee("invalid or has expired");
});

test("the password confirmation screen checks the password", async () => {
  const app = await client();
  const user = await User.factory().create();
  await app.actingAs(user);

  (await app.get("/confirm-password")).assertOk();
  (await app.post("/confirm-password", { password: "password" }, browser))
    .assertRedirect("/dashboard");

  await app.post("/confirm-password", { password: "wrong" }, {
    ...browser,
    Referer: "http://localhost/confirm-password",
  });
  await (await app.get("/confirm-password")).assertSee("The provided password is incorrect.");
});
