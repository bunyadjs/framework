import { expect } from "bun:test";
import { Application } from "@bunyad/core";
import { TestCase, test, testCase } from "../src/index.ts";
import { TestClient } from "../src/test-client.ts";

async function createApplication(): Promise<Application> {
  return new Application();
}

@testCase({ createApplication })
class DecoratorHarnessTest extends TestCase {
  @test()
  async boots_test_client(): Promise<void> {
    expect(this.client).toBeInstanceOf(TestClient);
    expect(this.app).toBeInstanceOf(Application);
  }

  @test("custom test title")
  async accepts_custom_name(): Promise<void> {
    expect(this.client.app).toBe(this.app);
  }
}
