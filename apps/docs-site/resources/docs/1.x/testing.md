---
title: Testing
description: Run feature tests with Bun, TestCase, and an in-process HTTP client.
---

# Testing

## Introduction

Bunyad apps are tested with [Bun’s test runner](https://bun.sh/docs/cli/test). `@bunyad/testing` adds a Laravel-shaped layer on top: a `TestCase` base class, an in-process HTTP client, response assertions, and helpers to reset the database between tests.

Put feature tests under `tests/` (or `tests/Feature`). Prefer class-based tests that boot your real `createApplication` factory so routes, middleware, and providers match production. For a single pure function, Bun’s native `test()` is enough — you do not need to boot the app.

Related chapters: [HTTP tests](/docs/1.x/http-tests), [database testing](/docs/1.x/database-testing), [console tests](/docs/1.x/console-tests), and [mocking](/docs/1.x/mocking).

## Environment

Point the app at a dedicated test database and an in-memory session before you boot. A common pattern is a `beforeBoot` hook on `@testCase`:

```ts
@testCase({
  createApplication,
  migrationsPath: "./database/migrations",
  beforeBoot() {
    process.env.SESSION_DRIVER = "memory";
    process.env.DATABASE_PATH = "./storage/testing.sqlite";
  },
})
class ExampleTest extends TestCase {
  // ...
}
```

Use whatever env keys your `config/database.ts` and session config read. Prefer a file or memory database that tests may wipe freely.

## Creating tests

Extend `TestCase`, decorate the class with `@testCase({ createApplication })`, and mark each method with `@test()`:

```ts title="tests/Feature/ExampleTest.ts"
import { TestCase, test, testCase } from "@bunyad/testing";
import { createApplication } from "../../bootstrap/app.ts";

@testCase({ createApplication })
class ExampleTest extends TestCase {
  @test()
  async home_returns_ok(): Promise<void> {
    const response = await this.get("/");
    response.assertOk();
  }
}
```

`@test("custom title")` overrides the Bun test name. Each method gets a fresh class instance: the client boots, then `setUp()` runs, then your method, then `tearDown()`.

You can also create a client by hand when you do not want a class:

```ts
import { test } from "bun:test";
import { TestClient } from "@bunyad/testing";
import { createApplication } from "../bootstrap/app.ts";

test("home returns ok", async () => {
  const client = await TestClient.create({ createApplication });
  const response = await client.get("/");
  response.assertOk();
});
```

There is no `make:test` stub command yet — add the file under `tests/` yourself.

## Running tests

From the app root:

```shell
bun test
bun test ./tests/Feature/ExampleTest.ts
```

Bun discovers `*.test.ts` files (and methods registered by `@test()`). Pass the same filters and reporters Bun already documents.

## Database between tests

Pass `migrationsPath` on `@testCase` / `TestClient.create` so the client wipes and migrates after boot. Call `this.refreshDatabase(path)` again inside a test when you need a second reset. See [Database testing](/docs/1.x/database-testing).

## Facades under test

Mail, queue, events, cache, storage, HTTP client, and notifications each expose a `.fake()` helper on their own package. The [Mocking](/docs/1.x/mocking) chapter lists them and links to the feature pages for full assert APIs.
