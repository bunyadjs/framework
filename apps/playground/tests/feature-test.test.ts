import { Hash } from "@bunyad/auth";
import { test, TestCase, testCase } from "@bunyad/testing";
import { createApplication } from "../bootstrap/app.ts";
import User from "../app/Models/User.ts";
import { clientDbFile, migrationsPath } from "./helpers.ts";

@testCase({
  createApplication,
  migrationsPath,
  beforeBoot() {
    process.env.SESSION_DRIVER = "memory";
    process.env.DATABASE_PATH = clientDbFile;
  },
})
class FeatureTest extends TestCase {
  @test()
  async index_returns_hello_json(): Promise<void> {
    const res = await this.getJson("/");
    res.assertOk();
    await res.assertJson({
      message: "Hello, Bunyad",
      framework: "bunyad",
    });
  }

  @test()
  async acting_as_reaches_dashboard(): Promise<void> {
    const user = await User.create({
      name: "Ada",
      email: "feature-test@example.com",
      password: await Hash.make("secret"),
    });

    await this.actingAs(user);
    const dash = await this.get("/dashboard");
    dash.assertOk();
    await dash.assertSee("Ada");
  }
}
