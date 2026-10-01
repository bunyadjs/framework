import { expect, test } from "bun:test";
import { Hash } from "@bunyad/auth";
import { TestClient } from "@bunyad/testing";
import { createApplication } from "../bootstrap/app.ts";
import Post from "../app/Models/Post.ts";
import User from "../app/Models/User.ts";
import { clientDbFile, migrationsPath } from "./helpers.ts";

test("TestClient getJson and actingAs", async () => {
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = clientDbFile;

  const client = await TestClient.create({
    createApplication,
    migrationsPath,
  });

  const res = await client.getJson("/");
  res.assertStatus(200);
  await res.assertJson({
    message: "Hello, Bunyad",
    framework: "bunyad",
  });

  const user = await User.create({
    name: "Ada",
    email: "acting@example.com",
    password: await Hash.make("secret"),
  });

  await client.actingAs(user);
  const dash = await client.get("/dashboard");
  expect(dash.status).toBe(200);
  await dash.assertSee("Ada");
});

test("TestClient can and assertCan for policies", async () => {
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = clientDbFile;

  const client = await TestClient.create({
    createApplication,
    migrationsPath,
  });
  const owner = await User.create({
    name: "Owner",
    email: "owner@example.com",
    password: await Hash.make("secret"),
  });
  const other = await User.create({
    name: "Other",
    email: "other@example.com",
    password: await Hash.make("secret"),
  });
  const post = await Post.create({ user_id: owner.id, title: "Owned" });

  await client.actingAs(owner);
  await client.assertCan("delete", post);

  await client.actingAs(other);
  await client.assertCannot("delete", post);

  const forbidden = await client.deleteJson(`/posts/${post.id}`);
  forbidden.assertForbidden();
});

test("Event.fake asserts UserRegistered on register", async () => {
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = clientDbFile;

  const { Event } = await import("@bunyad/events");
  const UserRegistered = (await import("../app/Events/UserRegistered.ts"))
    .default;

  const client = await TestClient.create({
    createApplication,
    migrationsPath,
  });
  const fake = Event.fake();

  const res = await client.postJson("/register", {
    name: "Ada",
    email: "event-fake@example.com",
    password: "secret",
  });
  res.assertStatus(302);

  Event.assertDispatched(UserRegistered, (e) => {
    return (e as InstanceType<typeof UserRegistered>).user.email ===
      "event-fake@example.com";
  });
  fake.restore();
});

test("Mail.fake on register welcome mail", async () => {
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = clientDbFile;

  const { Mail } = await import("@bunyad/mail");
  const client = await TestClient.create({
    createApplication,
    migrationsPath,
  });
  Mail.fake();

  const res = await client.postJson("/register", {
    name: "Ada",
    email: "mail-fake@example.com",
    password: "secret",
  });
  res.assertStatus(302);

  Mail.assertSent((m) => String(m.to).includes("mail-fake@example.com"));
  Mail.restore();
});

test("Notification.fake asserts WelcomeNotification on register", async () => {
  process.env.SESSION_DRIVER = "memory";
  process.env.DATABASE_PATH = clientDbFile;

  const { Notification } = await import("@bunyad/notifications");
  const WelcomeNotification = (
    await import("../app/Notifications/WelcomeNotification.ts")
  ).default;

  const client = await TestClient.create({
    createApplication,
    migrationsPath,
  });
  const fake = Notification.fake();

  const res = await client.postJson("/register", {
    name: "Ada",
    email: "notify-fake@example.com",
    password: "secret",
  });
  res.assertStatus(302);

  Notification.assertSentTo(
    { email: "notify-fake@example.com" },
    WelcomeNotification,
  );
  Notification.assertSentTimes(WelcomeNotification, 1);
  fake.restore();
});
