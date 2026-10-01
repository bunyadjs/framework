---
title: HTTP Tests
description: Drive your app with TestClient — get, postJson, actingAs, and response asserts.
---

# HTTP Tests

## Introduction

Feature tests hit your routes without opening a real TCP port. `TestClient` (and `TestCase` helpers that wrap it) build a `Request`, run it through the same kernel your server uses, and return a `TestResponse` with fluent asserts.

Import from `@bunyad/testing`. Boot the client with your app’s `createApplication` so providers, routes, and middleware match production.

## Making requests

```ts
const response = await this.get("/");
const json = await this.getJson("/api/users");

await this.post("/login", { email: "ada@example.com", password: "secret" });
await this.postJson("/api/users", { name: "Ada" });

await this.putJson(`/api/users/${id}`, { name: "Ada Lovelace" });
await this.patchJson(`/api/users/${id}`, { name: "Ada" });
await this.deleteJson(`/api/users/${id}`);
```

`*Json` helpers set `Accept: application/json` (and `Content-Type` on writes). Non-GET requests warm a session cookie and attach `X-CSRF-TOKEN` when the app issues one, so browser-style form posts work without extra setup.

Pass extra headers as the last argument:

```ts
await this.get("/report", { "X-Request-Id": "abc" });
```

## Authentication

Session auth uses `actingAs`. The client needs a session cookie and `app.instance("session.store")` (starters wire this):

```ts
import User from "@/Models/User.ts";

const user = await User.create({
  name: "Ada",
  email: "ada@example.com",
  password: await Hash.make("secret"),
});

await this.actingAs(user);
const response = await this.get("/dashboard");
response.assertOk();
```

Bearer tokens use `withToken` / `withoutToken`:

```ts
this.withToken("1|plain-text-token");
const response = await this.getJson("/api/user");
this.withoutToken();
```

## Authorization helpers

When a user is acting, assert Gate / policy outcomes without a full HTTP round trip:

```ts
await this.actingAs(owner);
await this.assertCan("delete", post);

await this.actingAs(other);
await this.assertCannot("delete", post);
```

`can(ability, …args)` returns a boolean if you prefer an explicit check.

## Status asserts

```ts
response.assertOk(); // 200
response.assertSuccessful(); // 2xx
response.assertCreated(); // 201
response.assertNoContent(); // 204 by default
response.assertStatus(418);

response.assertUnauthorized(); // 401
response.assertForbidden(); // 403
response.assertNotFound(); // 404
response.assertUnprocessable(); // 422
response.assertTooManyRequests(); // 429
response.assertServerError(); // 5xx
response.assertClientError(); // 4xx
```

Redirect helpers:

```ts
response.assertRedirect("/dashboard");
response.assertRedirectContains("dashboard");
response.assertLocation("/dashboard");
response.assertFound(); // 302
```

## Headers and content

```ts
response.assertHeader("Content-Type", "application/json");
response.assertHeaderContains("Content-Type", "json");
response.assertHeaderMissing("X-Debug");

await response.assertSee("Welcome");
await response.assertDontSee("stack trace");
await response.assertContent("exact body string");
```

## JSON asserts

```ts
await response.assertJson({ message: "Hello" });
await response.assertExactJson({ id: 1, name: "Ada" });
await response.assertJsonFragment({ email: "ada@example.com" });
await response.assertJsonMissing({ role: "admin" });
await response.assertJsonPath("user.email", "ada@example.com");
await response.assertJsonCount("data", 3);
await response.assertJsonStructure({
  data: [{ id: undefined, name: undefined }],
});
await response.assertJsonIsArray();
await response.assertJsonIsObject();
```

`assertJson` checks a subset. `assertExactJson` requires the whole body. `assertSimilarJson` compares after sorting object keys.

## Conditional chaining

```ts
await response
  .assertOk()
  .tap(async (res) => {
    // inspect res
  });

await response.when(debug, async (res) => {
  await res.assertHeader("X-Debug");
});
```

## Full example

```ts title="tests/Feature/DashboardTest.ts"
import { Hash } from "@bunyad/auth";
import { TestCase, test, testCase } from "@bunyad/testing";
import { createApplication } from "../../bootstrap/app.ts";
import User from "@/Models/User.ts";

@testCase({
  createApplication,
  migrationsPath: "./database/migrations",
  beforeBoot() {
    process.env.SESSION_DRIVER = "memory";
    process.env.DATABASE_PATH = "./storage/testing.sqlite";
  },
})
class DashboardTest extends TestCase {
  @test()
  async guests_are_redirected(): Promise<void> {
    const response = await this.get("/dashboard");
    response.assertRedirect("/login");
  }

  @test()
  async members_see_their_name(): Promise<void> {
    const user = await User.create({
      name: "Ada",
      email: "ada@example.com",
      password: await Hash.make("secret"),
    });

    await this.actingAs(user);
    const response = await this.get("/dashboard");
    response.assertOk();
    await response.assertSee("Ada");
  }
}
```
