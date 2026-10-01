import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { Hash } from "@bunyad/auth";
import { TestClient } from "@bunyad/testing";
import { createApplication } from "../bootstrap/app.ts";
import User from "@/Models/User.ts";

const dbFile = resolve(import.meta.dir, "../database/testing.sqlite");
const migrationsPath = resolve(import.meta.dir, "../database/migrations");

test("boots token JSON without a session", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });

  expect(client.app.bound("session.store")).toBe(false);
  expect(client.app.providerIsLoaded("AuthServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("DatabaseServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("MailServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("FilesystemServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("DumpServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("QueueServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("NotificationServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("BroadcastServiceProvider")).toBe(true);
  expect(client.app.providerIsLoaded("FeatureServiceProvider")).toBe(true);
  for (const name of [
    "SessionServiceProvider",
    "ViewServiceProvider",
    "LiveServiceProvider",
    "HeadServiceProvider",
    "InertiaServiceProvider",
  ]) {
    expect(client.app.providerIsLoaded(name)).toBe(false);
  }

  const res = await client.getJson("/");
  res.assertOk().assertHeaderMissing("Set-Cookie").assertHeaderMissing("X-CSRF-TOKEN");
});

test("GET / returns the app name", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  const res = await client.getJson("/");
  res.assertOk().assertHeaderMissing("Set-Cookie");
  await res.assertJson({ name: "Bunyad API" });
});

test("register returns 201 with a bearer token and never leaks the password", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });

  const res = await client.postJson("/api/register", {
    name: "Ada",
    email: "ada@example.com",
    password: "secret-password",
  });
  res.assertCreated().assertJsonMissing({ password: "secret-password" });
  const body = (await res.json()) as {
    token: string;
    token_type: string;
    user: { email: string; name: string; password?: string };
  };
  expect(body.token.length).toBeGreaterThan(10);
  expect(body.token_type).toBe("Bearer");
  expect(body.user.email).toBe("ada@example.com");
  expect(body.user.password).toBeUndefined();

  const stored = await User.where("email", "ada@example.com").first();
  expect(await Hash.check("secret-password", String(stored!.password))).toBe(true);

  const me = await client.withToken(body.token).getJson("/api/me");
  me.assertOk();
  const meBody = (await me.json()) as { data: { email: string } };
  expect(meBody.data.email).toBe("ada@example.com");
});

test("register validates the payload", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  await User.factory().create({ email: "taken@example.com" });

  const res = await client.postJson("/api/register", {
    name: "Ada",
    email: "taken@example.com",
    password: "short",
  });
  res.assertUnprocessable();
  const body = (await res.json()) as { errors: Record<string, string[]> };
  expect(Object.keys(body.errors).sort()).toEqual(["email", "password"]);
});

test("token flow issues bearer, returns /api/me, and revokes", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });

  await User.factory().create({
    name: "Ada",
    email: "token@example.com",
    password: await Hash.make("secret-password"),
  });

  const tokenRes = await client.postJson("/api/token", {
    email: "token@example.com",
    password: "secret-password",
  });
  tokenRes.assertOk();
  const { token } = (await tokenRes.json()) as { token: string };

  const me = await client.withToken(token).getJson("/api/me");
  me.assertOk();
  const body = (await me.json()) as {
    data: { id: number; name: string; email: string };
  };
  expect(body.data.email).toBe("token@example.com");
  expect(body.data.name).toBe("Ada");

  (await client.withToken(token).deleteJson("/api/token")).assertNoContent();
  (await client.withToken(token).getJson("/api/me")).assertUnauthorized();
});

test("wrong credentials return 422 on email and issue no token", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  await User.factory().create({
    email: "wrong@example.com",
    password: await Hash.make("secret-password"),
  });

  for (const email of ["wrong@example.com", "nobody@example.com"]) {
    const res = await client.postJson("/api/token", {
      email,
      password: "not-the-password",
    });
    res.assertUnprocessable();
    const body = (await res.json()) as { errors: Record<string, string[]> };
    expect(body.errors.email).toBeDefined();
  }
});

test("protected routes answer 401 JSON without a token", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });

  (await client.getJson("/api/me")).assertUnauthorized();
  (await client.get("/api/me")).assertUnauthorized();
  (await client.withToken("1|nope").getJson("/api/me")).assertUnauthorized();
});

test("token endpoint throttles repeated attempts per email", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });

  for (let i = 0; i < 5; i++) {
    (
      await client.postJson("/api/token", {
        email: "brute@example.com",
        password: "guess",
      })
    ).assertUnprocessable();
  }
  (
    await client.postJson("/api/token", {
      email: "brute@example.com",
      password: "guess",
    })
  ).assertTooManyRequests();
});

test("expired tokens are rejected and revoking all tokens signs every device out", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  const user = await User.factory().create({ email: "tokens@example.com" });

  const expired = await user.createToken("old", ["*"], new Date(Date.now() - 1000));
  (await client.withToken(expired).getJson("/api/me")).assertUnauthorized();

  const first = await user.createToken("phone");
  const second = await user.createToken("laptop");
  (await client.withToken(first).getJson("/api/me")).assertOk();
  await user.tokens().delete();
  (await client.withToken(first).getJson("/api/me")).assertUnauthorized();
  (await client.withToken(second).getJson("/api/me")).assertUnauthorized();
});

test("actingAs authenticates a token request without a session", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  const user = await User.factory().create({ email: "acting@example.com" });

  await client.actingAs(user);
  const me = await client.getJson("/api/me");
  me.assertOk();
  await me.assertJsonPath("data.email", "acting@example.com");
});

test("successful token requests never lock a client out", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  await User.factory().create({ email: "steady@example.com" });

  for (let i = 0; i < 8; i++) {
    (
      await client.postJson("/api/token", {
        email: "steady@example.com",
        password: "password",
      })
    ).assertOk();
  }
});

test("a blocked client cannot succeed with the right password", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  await User.factory().create({ email: "locked@example.com" });

  for (let i = 0; i < 5; i++) {
    (
      await client.postJson("/api/token", {
        email: "locked@example.com",
        password: "wrong",
      })
    ).assertUnprocessable();
  }
  (
    await client.postJson("/api/token", {
      email: "locked@example.com",
      password: "password",
    })
  ).assertTooManyRequests();
});

test("CORS headers reach the browser on validation and not-found errors", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  const headers = { Origin: "https://app.example.com" };

  const invalid = await client.postJson("/api/register", {}, headers);
  invalid.assertUnprocessable().assertHeader("Access-Control-Allow-Origin", "*");
  const missing = await client.getJson("/api/nope", headers);
  missing.assertNotFound().assertHeader("Access-Control-Allow-Origin", "*");
});

test("CORS preflight is answered for API routes", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });

  const res = await client.request("OPTIONS", "/api/register", undefined, {
    Origin: "https://app.example.com",
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type",
  });
  res.assertNoContent().assertHeader("Access-Control-Allow-Origin", "*");
  expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
});

test("DatabaseSeeder creates a user that can request a token", async () => {
  process.env.DATABASE_PATH = dbFile;
  const client = await TestClient.create({ createApplication, migrationsPath });
  const { default: DatabaseSeeder } = await import("@database/seeders/DatabaseSeeder.ts");
  await new DatabaseSeeder().run();

  (
    await client.postJson("/api/token", {
      email: "test@example.com",
      password: "password",
    })
  ).assertOk();
});
