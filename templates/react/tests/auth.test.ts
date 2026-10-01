import { expect, test } from "bun:test";
import { Notification, ResetPassword } from "@bunyad/framework";
import User from "@/Models/User.ts";
import { client, expectPage, inertia, visit } from "./client.ts";

test("the first visit is rendered on the server, with the page data to hydrate", async () => {
  const app = await client();
  const res = await app.get("/login", { Accept: "text/html" });
  res.assertOk();
  await res.assertSee('<h1 class="text-xl font-semibold">Log in to your account</h1>');
  await res.assertSee("<title data-inertia=\"\">Log in to your account - ");
  await res.assertSee('data-server-rendered="true"');
  await res.assertSee('data-page="app"');
  await res.assertSee('"component":"auth\\/login"');
});

test("welcome, login, and register pages render", async () => {
  const app = await client();
  await expectPage(app, "/", "welcome");
  await expectPage(app, "/login", "auth/login");
  await expectPage(app, "/register", "auth/register");
});

test("new users are logged in and land on the dashboard", async () => {
  const app = await client();
  (await app.post("/register", {
    name: "Ada Lovelace",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "password",
  }, inertia)).assertRedirect("/dashboard");

  const page = await expectPage(app, "/dashboard", "dashboard");
  expect(page.props.auth.user.name).toBe("Ada Lovelace");
  expect(page.props.auth.user.initials).toBe("AL");
});

test("registration errors come back as first messages", async () => {
  const app = await client();
  await visit(app, "/register");
  (await app.post("/register", {
    name: "Ada",
    email: "ada@example.com",
    password: "password",
    password_confirmation: "different",
  }, { ...inertia, Referer: "http://localhost/register" })).assertRedirect("http://localhost/register");

  const page = await visit(app, "/register");
  expect(typeof page.props.errors.password).toBe("string");
  expect(page.props.errors.password).toContain("confirmation");
  expect(await User.where("email", "ada@example.com").exists()).toBe(false);
});

test("users log in with valid credentials", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  (await app.post("/login", { email: "ada@example.com", password: "password" }, inertia)).assertRedirect("/dashboard");
  await expectPage(app, "/dashboard", "dashboard");
});

test("a wrong password shows an error and keeps the user a guest", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  await app.post("/login", { email: "ada@example.com", password: "wrong" }, { ...inertia, Referer: "http://localhost/login" });

  expect((await visit(app, "/login")).props.errors.email).toBe("These credentials do not match our records.");
  (await app.get("/dashboard", inertia)).assertRedirect("/login");
});

test("five failed logins lock the email out", async () => {
  const app = await client();
  await User.factory().create({ email: "locked@example.com" });
  for (let i = 0; i < 5; i += 1) {
    await app.post("/login", { email: "locked@example.com", password: "wrong" }, inertia);
  }
  await app.post("/login", { email: "locked@example.com", password: "password" }, { ...inertia, Referer: "http://localhost/login" });

  expect((await visit(app, "/login")).props.errors.email).toContain("Too many login attempts.");
});

test("remember me sets a cookie", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  const res = await app.post("/login", { email: "ada@example.com", password: "password", remember: true }, inertia);
  expect(res.headers.getSetCookie().some((c) => c.startsWith("remember_web="))).toBe(true);
});

test("users can log out", async () => {
  const app = await client();
  await User.factory().create({ email: "ada@example.com" });
  await app.post("/login", { email: "ada@example.com", password: "password" }, inertia);

  (await app.post("/logout", undefined, inertia)).assertRedirect("/");
  (await app.get("/dashboard", inertia)).assertRedirect("/login");
});

test("a reset link is mailed and resets the password", async () => {
  const app = await client();
  const fake = Notification.fake();
  const user = await User.factory().create({ email: "ada@example.com" });

  await app.post("/forgot-password", { email: "ada@example.com" }, { ...inertia, Referer: "http://localhost/forgot-password" });
  expect((await visit(app, "/forgot-password")).props.status).toContain("A reset link will be sent");

  Notification.assertSentTo(user, ResetPassword);
  const mail = fake.sent(ResetPassword)[0]!.notification as ResetPassword;
  fake.restore();

  const url = new URL(mail.url);
  const reset = await expectPage(app, url.pathname + url.search, "auth/reset-password");
  expect(reset.props.email).toBe("ada@example.com");
  expect(reset.props.token).toBe(mail.token);

  (await app.post("/reset-password", {
    token: mail.token,
    email: "ada@example.com",
    password: "new-password",
    password_confirmation: "new-password",
  }, inertia)).assertRedirect("/login");
  expect((await visit(app, "/login")).props.status).toBe("Your password has been reset.");

  (await app.post("/login", { email: "ada@example.com", password: "new-password" }, inertia)).assertRedirect("/dashboard");
});

test("the password confirmation screen checks the password", async () => {
  const app = await client();
  await app.actingAs(await User.factory().create());

  await expectPage(app, "/confirm-password", "auth/confirm-password");
  await app.post("/confirm-password", { password: "wrong" }, { ...inertia, Referer: "http://localhost/confirm-password" });
  expect((await visit(app, "/confirm-password")).props.errors.password).toBe("The provided password is incorrect.");
  (await app.post("/confirm-password", { password: "password" }, inertia)).assertRedirect("/dashboard");
});
