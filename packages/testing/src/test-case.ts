import type { Authenticatable } from "@bunyad/auth";
import type { Application } from "@bunyad/core";
import {
  assertDatabaseCount,
  assertDatabaseHas,
  assertDatabaseMissing,
  assertSoftDeleted,
} from "./database-assertions.ts";
import { PendingCommand } from "./pending-command.ts";
import {
  TestClient,
  type TestClientOptions,
  type TestResponse,
} from "./test-client.ts";
import { getTestCaseConfig } from "./test-case-config.ts";
import { freezeTime as freezeClock, travel as travelClock, travelBack as restoreClock } from "./time-travel.ts";

export { testCase, type TestCaseOptions } from "./test-case-config.ts";

/**
 * HTTP helpers via an in-process `TestClient`.
 * Pair with `@testCase({ createApplication })` and `@test()` on methods.
 */
export class TestCase {
  protected client!: TestClient;

  get app(): Application {
    return this.client.app;
  }

  /** Booted by `@test()` before `setUp()`. */
  async bootClient(): Promise<void> {
    if (this.client) return;
    const options = getTestCaseConfig(this.constructor);
    if (!options) {
      throw new Error(
        `${this.constructor.name} requires @testCase({ createApplication }).`,
      );
    }
    await options.beforeBoot?.();
    this.client = await TestClient.create(options);
  }

  /** Override for per-test setup (runs after the client is booted). */
  async setUp(): Promise<void> {}

  /** Override for per-test teardown. */
  async tearDown(): Promise<void> {}

  withToken(token: string): this {
    this.client.withToken(token);
    return this;
  }

  withoutToken(): this {
    this.client.withoutToken();
    return this;
  }

  async actingAs(user: Authenticatable): Promise<this> {
    await this.client.actingAs(user);
    return this;
  }

  can(ability: string, ...args: unknown[]): Promise<boolean> {
    return this.client.can(ability, ...args);
  }

  async assertCan(ability: string, ...args: unknown[]): Promise<this> {
    await this.client.assertCan(ability, ...args);
    return this;
  }

  async assertCannot(ability: string, ...args: unknown[]): Promise<this> {
    await this.client.assertCannot(ability, ...args);
    return this;
  }

  get(uri: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.client.get(uri, headers);
  }

  getJson(uri: string, headers?: Record<string, string>): Promise<TestResponse> {
    return this.client.getJson(uri, headers);
  }

  post(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.post(uri, data, headers);
  }

  postJson(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.postJson(uri, data, headers);
  }

  put(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.put(uri, data, headers);
  }

  putJson(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.putJson(uri, data, headers);
  }

  patch(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.patch(uri, data, headers);
  }

  patchJson(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.patchJson(uri, data, headers);
  }

  delete(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.delete(uri, data, headers);
  }

  deleteJson(
    uri: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> {
    return this.client.deleteJson(uri, data, headers);
  }

  async refreshDatabase(
    migrationsPath: string,
    options: Pick<TestClientOptions, "seed"> = {},
  ): Promise<this> {
    await this.client.refreshDatabase(migrationsPath, options);
    return this;
  }

  async assertDatabaseHas(
    table: string,
    data: Record<string, unknown>,
  ): Promise<this> {
    await assertDatabaseHas(table, data);
    return this;
  }

  async assertDatabaseMissing(
    table: string,
    data: Record<string, unknown>,
  ): Promise<this> {
    await assertDatabaseMissing(table, data);
    return this;
  }

  async assertDatabaseCount(
    table: string,
    count: number,
    data: Record<string, unknown> = {},
  ): Promise<this> {
    await assertDatabaseCount(table, count, data);
    return this;
  }

  /**
   * Run a CLI command and return fluent exit-code / output asserts.
   * Chain `expectsQuestion` / `expectsOutput` before `assertSuccessful`.
   */
  command(name: string, args: string[] = []): PendingCommand {
    return new PendingCommand(async () => {
      const previous = process.exitCode;
      process.exitCode = 0;

      const chunks: string[] = [];
      const originalLog = console.log;
      const originalError = console.error;
      const capture = (...parts: unknown[]) => {
        chunks.push(parts.map(String).join(" "));
      };
      console.log = capture;
      console.error = capture;

      try {
        const { run } = await import("@bunyad/cli");
        await run([name, ...args]);
      } finally {
        console.log = originalLog;
        console.error = originalError;
      }

      const exitCode =
        typeof process.exitCode === "number" ? process.exitCode : 0;
      process.exitCode = previous;
      return { exitCode, output: chunks.join("\n") };
    });
  }

  async assertSoftDeleted(
    modelOrClass: Parameters<typeof assertSoftDeleted>[0],
    id?: unknown,
  ): Promise<this> {
    await assertSoftDeleted(modelOrClass, id);
    return this;
  }

  travel(to: number | Date | string): this {
    travelClock(to);
    return this;
  }

  freezeTime(at?: Date | number): this {
    freezeClock(at);
    return this;
  }

  travelBack(): this {
    restoreClock();
    return this;
  }
}
