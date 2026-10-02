# @bunyad/testing

Test helpers for Bunyad apps: an in-process HTTP `TestClient` with fluent assertions, database assertions and refresh, a `TestCase` base class with `@test()` / `@testCase()` decorators, and a controllable clock.

> **Beta.** Public APIs change only in minor releases, with a changelog entry and migration note. See the [stability policy](https://github.com/bunyadjs/framework/blob/main/docs/STABILITY.md).

```bash
bun add -d @bunyad/testing@beta
# or: npm install -D @bunyad/testing@beta
```

## Usage

```ts
import { expect, test } from "bun:test";
import { Application } from "@bunyad/core";
import { json } from "@bunyad/http";
import { TestClient, freezeTime, travel, travelBack } from "@bunyad/testing";

async function createApplication() {
  const app = new Application({ config: { app: { port: 0 } } });
  app.router.get("/hello", () => json({ hello: "world" }));
  await app.boot();
  return app;
}

test("GET /hello", async () => {
  const client = await TestClient.create({ createApplication });
  const res = await client.getJson("/hello");
  res.assertOk().assertJson({ hello: "world" });
  console.log(res.status, await res.json()); // 200 { hello: "world" }
});

test("clock", () => {
  freezeTime(Date.parse("2030-01-01T00:00:00Z"));
  travel("+1 hours"); // also "+30m", "-2 days", or a number of milliseconds
  expect(new Date().toISOString()).toBe("2030-01-01T01:00:00.000Z");
  travelBack(); // restore the real clock
});
```

## Notes

- Runs on Bun only (1.4 or newer), under `bun test`.
- Requests go straight to the app's fetch handler, with no network. The client also offers `actingAs`, `withToken`, `withSession`, `attach` (uploads) and `postJson` / `putJson` / `patchJson` / `deleteJson`.
- Pass `migrationsPath` (and optional `seed`) to `TestClient.create` to reset the database, or call `refreshDatabase()` directly. `assertDatabaseHas`, `assertDatabaseMissing`, `assertDatabaseCount` and `assertSoftDeleted` check rows.
- Class style: decorate a `TestCase` subclass with `@testCase({ createApplication })` and its methods with `@test()`.
- Depends on `@bunyad/core`, `@bunyad/http`, `@bunyad/auth`, `@bunyad/database` and `@bunyad/cli`.

## License

MIT
